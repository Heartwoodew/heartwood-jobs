// Job requirements. Office copies a builder pack onto the job and can edit it.
// Assigned crew can read the text and tick items. They cannot change the words.
// No prices, tip fees, rates, or ex GST text are stored or shown.
//
// Coral Homes: there is no per-job work-order email yet. Packs are the reusable
// template from the 24 Nov 2026 "Heartwood Earthworx - Price File" (Annexure C
// site cleans, earthworks trade specification CON-WKI-0003 Rev 24 Mar 2025 v4,
// and the price-file scope codes) plus the 25 Nov 2026 rule that a SWMS is on
// site before work starts. Annexure C points at Schedule 2 for waste. That
// schedule was not attached, so the line stays "All waste off site (Schedule 2)."
// Cost codes are documented in features/inbox-import.js (CORAL_COST_CODE_MAP).
// This module does not parse Coral email.

import { isHeartwoodCompany } from "./company.js";

export const CORAL_TEMPLATE_ID = "coral-homes";
export const HEARTWOOD_TEMPLATE_ID = "heartwood-default";
export const CORAL_CLIENT = "Coral Homes Qld Pty Ltd";
export const CORAL_ALIAS = "Coral Homes";
export const TEMPLATE_SOURCE = "template";
export const CUSTOM_SOURCE = "custom";
export const EMAIL_SOURCE = "email";

export const SECTIONS = ["shared", "earthworks", "setup", "spoil", "clean", "close"];
export const SECTION_LABELS = {
  shared: "Every job",
  earthworks: "Earthworks",
  setup: "Site set-up",
  spoil: "Spoil",
  clean: "Site clean",
  close: "End of the job",
};
export const CLEAN_STAGES = ["first", "second-lowset", "second-highset", "third", "final"];
export const CLEAN_STAGE_LABELS = {
  first: "First / rough-in",
  "second-lowset": "Second, lowset",
  "second-highset": "Second, highset",
  third: "Third",
  final: "Final / practical completion",
};
export const STOREYS = ["single", "two"];

// Same codes as CORAL_COST_CODE_MAP in inbox-import.js. Codes only. No prices.
export const REQUIREMENT_COST_CODES = Object.freeze({
  "195": { pack: "earthworks", label: "Cut and fill" },
  "197100": { pack: "spoil", label: "Spoil export" },
  "297000": { pack: "setup", label: "Site set-up / back-blade" },
  "297200": { pack: "setup", label: "Site set-up / back-blade" },
  "526210": { pack: "setup", label: "Site set-up / back-blade" },
  "6350015": { pack: "clean", stage: "first", label: "First / rough-in clean" },
  "6360015": { pack: "clean", stage: "second-lowset", label: "Second clean, lowset" },
  "6360017": { pack: "clean", stage: "second-highset", label: "Second clean, highset" },
  "6370015": { pack: "clean", stage: "third", label: "Third clean" },
  "6380015": { pack: "clean", stage: "final", label: "Final / practical completion" },
});

const CODE_ORDER = ["6380015", "6370015", "6360017", "6360015", "6350015", "526210", "297200", "297000", "197100"];
const SETUP_CODES = new Set(["297000", "297200", "526210"]);
const NOTE_FIELDS = [
  ["access", "Access"],
  ["cage", "Cage location"],
  ["extraSpoil", "Extra spoil requested"],
  ["plansPegs", "Plans and pegs on site"],
  ["other", "Other instructions"],
];
const ID_PREFIX = {
  shared: "rshared",
  earthworks: "rearth",
  setup: "rsetup",
  spoil: "rspoil",
  clean: "rclean",
  close: "rclose",
};

const DUMP_DOCKETS = "Photograph the dump dockets and attach them to the job.";

export function requirementText(text) {
  return String(text == null ? "" : text)
    .replace(/(?:A|AU)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:ex|inc|incl)\.?\s?GST)?|\$|\bex\.?\s*GST\b|\btip fees?\b|\brates?\b/gi, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normClient(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isCoralClient(name) {
  const n = normClient(name);
  return n === "coral homes" || n === "coral homes qld" || n === "coral homes qld pty ltd";
}

export function canonicalClientName(name) {
  const trimmed = String(name || "").trim();
  return isCoralClient(trimmed) ? CORAL_CLIENT : trimmed;
}

function blobOf(job) {
  return `${job && job.address || ""} ${job && job.suburb || ""} ${job && job.region || ""} ${job && job.state || ""}`;
}

export function isPortMacquarie(job) {
  return /port macquarie/i.test(blobOf(job));
}

export function isNswJob(job) {
  if (String(job && job.state || "").toUpperCase() === "NSW") return true;
  if (String(job && job.region || "").toUpperCase() === "NSW") return true;
  if (/\bNSW\b/.test(blobOf(job))) return true;
  return isPortMacquarie(job);
}

function matchCode(text) {
  const src = String(text || "").replace(/\s+/g, "");
  for (const code of CODE_ORDER) if (src.includes(code)) return code;
  const earth = src.match(/195\d{3,}/);
  return earth ? earth[0] : "";
}

export function costCodeOf(job) {
  const jobCode = matchCode(job && job.costCode);
  if (jobCode) return jobCode;
  return matchCode(`${job && job.po || ""} ${job && job.description || ""} ${job && job.typeLabel || ""}`);
}

export function packFromCode(code) {
  if (!code) return "";
  if (REQUIREMENT_COST_CODES[code] && REQUIREMENT_COST_CODES[code].stage) return "clean";
  if (SETUP_CODES.has(code)) return "setup";
  if (code === "197100" || /^197\d*$/.test(code)) return "spoil";
  if (/^195\d*$/.test(code)) return "earthworks";
  return "";
}

export function detectStorey(job) {
  if (job && (job.storey === "single" || job.storey === "two")) return job.storey;
  const text = `${job && job.description || ""}`.toLowerCase();
  if (/two[-\s]?storey|double storey|\b2 storey\b/.test(text)) return "two";
  if (/single[-\s]?storey|\b1 storey\b/.test(text)) return "single";
  return "";
}

export function detectCleanStage(job) {
  if (job && CLEAN_STAGES.includes(job.cleanStage)) return job.cleanStage;
  const code = costCodeOf(job);
  if (REQUIREMENT_COST_CODES[code] && REQUIREMENT_COST_CODES[code].stage) return REQUIREMENT_COST_CODES[code].stage;
  const text = `${job && job.description || ""} ${job && job.typeLabel || ""}`.toLowerCase();
  if (/practical completion|\bfinal clean\b|\bfinal\b/.test(text)) return "final";
  if (/third clean|wet[-\s]?area/.test(text)) return "third";
  if (/second/.test(text) && /highset|high set/.test(text)) return "second-highset";
  if (/second/.test(text) && /lowset|low set|cladding|lining/.test(text)) return "second-lowset";
  if (/rough[-\s]?in|first clean|before bricks/.test(text)) return "first";
  return "";
}

export function packKind(job) {
  const fromCode = packFromCode(costCodeOf(job));
  if (fromCode) return fromCode;
  const type = String(job && job.type || "").toLowerCase();
  if (type === "spoil") return "spoil";
  if (type === "backslab" || type === "setup" || type === "back-blade") return "setup";
  if (type === "clean" || type === "site-clean") return "clean";
  if (type === "earthworks" || type === "cut-and-fill" || type === "cutfill" || type === "cut") return "earthworks";
  const text = `${job && job.description || ""} ${job && job.typeLabel || ""}`.toLowerCase();
  if (/\bspoil\b/.test(text) && !/back-?\s?slab|back-?\s?blade/.test(text)) return "spoil";
  if (/back-?\s?slab|back-?\s?blade|site set-?\s?up/.test(text)) return "setup";
  if (/site clean|\bclean\b|rough-?\s?in|practical completion/.test(text)) return "clean";
  if (/cut and fill|cut & fill|earthworks|pad cut/.test(text)) return "earthworks";
  return "";
}

function silicaLine(job) {
  return isNswJob(job)
    ? "Follow the New South Wales silica dust rules."
    : "Follow the Queensland RCS and silica dust rules.";
}

function sharedLines(job) {
  return [
    "SWMS supplied and on site before the job starts.",
    "Report property damage or injury to the Coral Building Supervisor immediately.",
    "Report sediment-fence damage to the Building Supervisor as soon as possible.",
    silicaLine(job),
    "Do not import or export fill without an official Coral purchase order.",
    "Do not increase the pad size without an amended purchase order.",
    "Do not remove illegally dumped rubbish without a quote and prior Coral approval.",
    "Spoil or driveway-gravel removal is a separate job when Coral does the driveway.",
    "All waste off site (Schedule 2).",
    "Sweep roads and footpaths on cleans.",
  ];
}

function earthworksLines() {
  return [
    "Do not cut without an official order, Coral construction plans and surveyor earthworks pegs.",
    "Cut the pad to within 25 mm.",
    "Do not change the RL without written confirmation from the Supervisor or the Area Building Manager.",
    "Track-roll the cut and fill to 78% or more.",
    "Imported fill in layers of 75 mm at most, with clay at 30% or less, and no organics, contaminants, silt, wood, metal, plastic or boulders.",
    "Keep the pad at least 1200 mm larger than the nominated slab.",
    "Put a 200 mm spoon drain at the base of cut batters, and do not drain it onto a neighbour.",
    "Remove trees only inside the pad, unless there is written Area Building Manager approval.",
    "Cut the temporary driveway ready for gravel and sediment control.",
    "Report unsafe trees to the supervisor.",
  ];
}

function heartwoodBackslabLines() {
  return [
    "Take before photos and walk around for hazards or variations, and raise them with the supervisor.",
    "Use all available on-site spoil before bringing in CBR15.",
    "Leave an even fall away from the slab, with the finished height 50 to 100 mm below the rebate.",
    "Remove construction debris.",
    "Final trim with the spreader bar.",
    "Get the supervisor's go-ahead before carting off leftover spoil or concrete.",
    "Clean the slab, road and footpath thoroughly.",
    "Reinstate the silt fence.",
    "Take after photos.",
  ];
}

function heartwoodCleanLines() {
  return [
    "Take before photos and walk around for extras or variations, and discuss them with the supervisor.",
    "Move rubbish to the front of the property.",
    "Final trim with the spreader bar where needed.",
    "Clean the road and footpath thoroughly.",
    "Reinstate the silt fence.",
    "Take after photos.",
  ];
}

function heartwoodSharedLines() {
  return [
    "White card, tickets and a signed SWMS before work. Keep the SWMS on site or in the vehicle.",
    "Wear the PPE the SWMS requires, and a hard hat within 6 m of plant.",
    "Complete the plant pre-start every day before use.",
    "Keep a first aid kit on hand.",
    "Report injuries, hazards, incidents and near misses to the builder or supervisor.",
    "Use a spotter for reversing plant or vehicles.",
    "Unload inside the boundary.",
    "Noisy work only from 6:30 am to 6:30 pm.",
    "No alcohol, drugs or dogs.",
    "At the end of the day, make excavations safe, secure the plant and lock the gates.",
    "Variations only when directed in writing.",
  ];
}

function heartwoodCloseLines() {
  return [
    "Take plenty of final photos.",
    "Mark the job complete.",
    "Clean mud off the slab, footpath and road.",
    "Upload the dump dockets.",
  ];
}

function heartwoodSpoilLines() {
  return [
    "Use on-site spoil first.",
    "Get the supervisor's approval before removing spoil or concrete.",
    DUMP_DOCKETS,
    "Empty the truck at the end of the day.",
  ];
}

function heartwoodEarthworksLines() {
  return [
    "Inspect the base and tell the builder in writing if the site is not ready.",
    "Keep 3 m from live overhead lines (up to 132 kV).",
    "Set an exclusion zone around plant.",
    "Bench, batter or shore trenches 1.5 m or deeper.",
    "Barricade and sign open excavations.",
    "Dial Before You Dig before digging.",
    "Water down dust in dry weather.",
  ];
}

function setupLines() {
  return [
    "Back-blade the existing spoil about 1 m around the slab so the working platform does not pond.",
    "Bring in extra spoil only when the supervisor requested it and it was delivered before the start.",
    "Agree the skip or cage location with the Site Supervisor.",
    "Remove leftover steel from the slab pour.",
    "Fold the slab plastic up the outside vertical face around the full perimeter before back-blading.",
    "A temporary R82 mesh rubbish enclosure is optional: 1.2 m high, 3 m by 3 m or 4 m by 2 m.",
    ...heartwoodBackslabLines(),
  ];
}

function spoilLines() {
  return [
    "Record the loads.",
    "An official purchase order is required before spoil is exported.",
    DUMP_DOCKETS,
  ];
}

function cleanLines(job) {
  const stage = detectCleanStage(job);
  const lines = [];
  if (stage === "first") {
    lines.push(
      "First clean (rough-in), before bricks and plaster.",
      "Skip changeover on the first clean.",
      "Handpicked clean, 2 men / 1 hour.",
      "Sweep on the first clean.",
      "All waste off site (Schedule 2).",
    );
  } else if (stage === "second-lowset") {
    lines.push(
      "Second clean, lowset, for cladding and linings.",
      "Second clean, 1 man / 1 hour.",
    );
  } else if (stage === "second-highset") {
    lines.push("Second clean, highset.");
  } else if (stage === "third") {
    lines.push("Third clean when wet-area tiling is complete (lowset over 350 m2, and highset).");
  } else if (stage === "final") {
    lines.push(
      "Final clean at practical completion.",
      "Skip changeover on the final clean.",
      "1 man / 1 hour preparing the waste.",
      "Bobcat the remaining builder waste into the skips.",
      "Tidy the ground only. This is not landscaping.",
      "Remove appliance cardboard.",
      "Sweep on the final clean.",
      "All waste off site (Schedule 2).",
    );
  } else {
    lines.push("Site clean. Set the stage (first, second, third or final) from the description or the cost code.");
  }
  lines.push(...heartwoodCleanLines());
  if (detectStorey(job) === "two") {
    lines.push(
      "Two-storey: add a clean after the bricks and plaster.",
      "Two-storey: add a clean after cladding and tiling, once the scaffold is down.",
    );
  }
  lines.push(isPortMacquarie(job)
    ? "In Port Macquarie, plasterboard is not recycled by others."
    : "Plasterboard is recycled by others.");
  return lines;
}

function linesFor(section, job, templateId) {
  const heartwood = templateId === HEARTWOOD_TEMPLATE_ID;
  if (section === "shared") return heartwood ? heartwoodSharedLines() : sharedLines(job);
  if (section === "close") return heartwood ? heartwoodCloseLines() : [];
  if (section === "earthworks") return heartwood ? heartwoodEarthworksLines() : earthworksLines();
  if (section === "setup") return heartwood ? heartwoodBackslabLines() : setupLines();
  if (section === "spoil") return heartwood ? heartwoodSpoilLines() : spoilLines();
  if (section === "clean") {
    if (heartwood) return [...heartwoodCleanLines(), "Leave the site looking tidy."];
    return cleanLines(job);
  }
  return [];
}

function itemId(section, index) {
  return ID_PREFIX[section] + String(index).padStart(2, "0");
}

export function emptyNotes() {
  return { access: "", cage: "", extraSpoil: "", plansPegs: "", other: "" };
}

export function formatNotes(fields) {
  const src = fields || {};
  return NOTE_FIELDS.map(([key, label]) => `${label}: ${requirementText(src[key] || "")}`).join("\n");
}

export function parseNotes(text) {
  const src = String(text || "");
  const out = emptyNotes();
  for (const [key, label] of NOTE_FIELDS) {
    const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.*)$", "im");
    const hit = src.match(re);
    out[key] = hit ? requirementText(hit[1]) : "";
  }
  return out;
}

function cleanLine(text) {
  const next = requirementText(text).slice(0, 500);
  return next;
}

export function chosenTemplate(job, opts = {}) {
  const companyId = opts.companyId || (job && job.companyId) || "heartwood";
  if (!isHeartwoodCompany(companyId)) return "";
  if (opts.templateId === CORAL_TEMPLATE_ID || opts.templateId === HEARTWOOD_TEMPLATE_ID) return opts.templateId;
  if (isCoralClient(job && job.client) || isCoralClient(job && job.builder)) return CORAL_TEMPLATE_ID;
  return HEARTWOOD_TEMPLATE_ID;
}

export function buildTemplateItems(job, templateId = CORAL_TEMPLATE_ID) {
  const kind = packKind(job);
  const sections = ["shared"];
  if (kind && kind !== "shared" && kind !== "close") sections.push(kind);
  if (templateId === HEARTWOOD_TEMPLATE_ID) sections.push("close");
  const items = [];
  sections.forEach(section => {
    linesFor(section, job, templateId).forEach((text, index) => {
      const line = cleanLine(text);
      if (!line) return;
      items.push({
        id: itemId(section, index),
        section,
        text: line,
        source: TEMPLATE_SOURCE,
        sort: items.length,
        done: false,
        doneBy: "",
        doneAt: null,
      });
    });
  });
  return items;
}

function catalogue(companyId, templateId, sample) {
  const items = [];
  for (const section of SECTIONS) {
    linesFor(section, sample, templateId).forEach(text => {
      const line = cleanLine(text);
      if (line) items.push({ section, text: line });
    });
  }
  return items.slice(0, 80);
}

export function coralTemplateDoc(companyId) {
  return {
    companyId: companyId || "heartwood",
    templateId: CORAL_TEMPLATE_ID,
    builder: CORAL_ALIAS,
    title: "Coral Homes",
    items: catalogue(companyId, CORAL_TEMPLATE_ID, { client: CORAL_CLIENT, type: "clean", cleanStage: "final", storey: "" }),
  };
}

export function heartwoodTemplateDoc(companyId) {
  return {
    companyId: companyId || "heartwood",
    templateId: HEARTWOOD_TEMPLATE_ID,
    builder: "Heartwood",
    title: "Heartwood",
    items: catalogue(companyId, HEARTWOOD_TEMPLATE_ID, { client: "Private", type: "clean" }),
  };
}

export function planRequirementWrite(job, existingItems, opts = {}) {
  const companyId = opts.companyId || (job && job.companyId) || "heartwood";
  const templateId = chosenTemplate(job, opts);
  if (!templateId) {
    return { apply: false, kind: packKind(job), storey: "", cleanStage: "", items: [], deleteIds: [], template: null, meta: null };
  }
  const storey = detectStorey(job);
  const cleanStage = packKind(job) === "clean" ? detectCleanStage(job) : (CLEAN_STAGES.includes(job && job.cleanStage) ? job.cleanStage : "");
  const built = buildTemplateItems({ ...job, storey, cleanStage }, templateId);
  const previous = Array.isArray(existingItems) ? existingItems : [];
  const prevTemplate = previous.filter(item => item && item.source === TEMPLATE_SOURCE);
  const custom = previous.filter(item => item && item.source && item.source !== TEMPLATE_SOURCE);
  const byText = new Map(prevTemplate.map(item => [`${item.section}\n${item.text}`, item]));
  const items = built.map(item => {
    const prev = byText.get(`${item.section}\n${item.text}`);
    if (!prev) return { ...item, companyId };
    return {
      ...item,
      id: prev.id || item.id,
      companyId: prev.companyId || companyId,
      done: !!prev.done,
      doneBy: prev.doneBy || "",
      doneAt: prev.doneAt || null,
      createdAt: prev.createdAt || null,
    };
  });
  custom.forEach((item, index) => {
    const text = cleanLine(item.text);
    if (!text) return;
    items.push({
      ...item,
      text,
      companyId: item.companyId || companyId,
      section: SECTIONS.includes(item.section) ? item.section : "shared",
      source: item.source === EMAIL_SOURCE ? EMAIL_SOURCE : CUSTOM_SOURCE,
      sort: 800 + index,
      done: !!item.done,
      doneBy: item.doneBy || "",
      doneAt: item.doneAt || null,
    });
  });
  const kept = new Set(items.map(item => item.id));
  const deleteIds = prevTemplate.map(item => item.id).filter(id => id && !kept.has(id));
  const notes = opts.notes != null ? requirementText(opts.notes).slice(0, 2000) : formatNotes(emptyNotes());
  return {
    apply: true,
    kind: packKind(job),
    storey,
    cleanStage,
    items,
    deleteIds,
    template: templateId === CORAL_TEMPLATE_ID ? coralTemplateDoc(companyId) : heartwoodTemplateDoc(companyId),
    meta: {
      templateId,
      builder: templateId === CORAL_TEMPLATE_ID ? CORAL_ALIAS : "Heartwood",
      storey,
      cleanStage,
      notes,
    },
  };
}

export function itemWriteBody(item, { companyId, uid, create, serverTimestamp }) {
  const text = cleanLine(item && item.text);
  const body = {
    companyId,
    section: item.section,
    text,
    source: item.source === EMAIL_SOURCE ? EMAIL_SOURCE : (item.source === CUSTOM_SOURCE ? CUSTOM_SOURCE : TEMPLATE_SOURCE),
    sort: Number.isFinite(+item.sort) ? +item.sort : 0,
    done: !!item.done,
    doneBy: String(item.doneBy || "").slice(0, 128),
    doneAt: item.doneAt || null,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
  if (create) body.createdAt = serverTimestamp();
  return body;
}

export function tickWriteBody(uid, done, serverTimestamp) {
  return {
    done: !!done,
    doneBy: done ? uid : "",
    doneAt: done ? serverTimestamp() : null,
    updatedBy: uid,
  };
}

export async function commitRequirementPlan(env, jobId, plan, existingIds) {
  if (!plan || !plan.apply) return { ok: true, applied: false };
  const { db, doc, setDoc, deleteDoc, getDoc, serverTimestamp, companyId, uid } = env;
  if (plan.template) {
    const ref = doc(db, "companies", companyId, "requirementTemplates", plan.template.templateId || CORAL_TEMPLATE_ID);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { ...plan.template, updatedAt: serverTimestamp(), updatedBy: uid });
    }
  }
  if (plan.meta) {
    await setDoc(doc(db, "jobs", jobId, "requirementMeta", "current"), {
      templateId: plan.meta.templateId || "",
      builder: plan.meta.builder || "",
      storey: plan.meta.storey || "",
      cleanStage: plan.meta.cleanStage || "",
      notes: requirementText(plan.meta.notes || "").slice(0, 2000),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  }
  const have = existingIds || new Set();
  for (const item of plan.items) {
    if (!item.id || !cleanLine(item.text)) continue;
    const create = !have.has(item.id);
    await setDoc(
      doc(db, "jobs", jobId, "requirementItems", item.id),
      itemWriteBody(item, { companyId, uid, create, serverTimestamp }),
      { merge: !create },
    );
  }
  for (const id of plan.deleteIds || []) {
    await deleteDoc(doc(db, "jobs", jobId, "requirementItems", id));
  }
  return { ok: true, applied: true };
}

// A job saved with no signal never wrote its checklist. The next online open fills it once.
export async function ensureRequirementPlan(env, job) {
  if (!env || !job || !job.id) return { ok: false, applied: false };
  const plan = planRequirementWrite(job, [], { companyId: env.companyId, uid: env.uid });
  if (!plan.apply) return { ok: true, applied: false };
  const metaSnap = await env.getDoc(env.doc(env.db, "jobs", job.id, "requirementMeta", "current"));
  if (metaSnap && metaSnap.exists()) return { ok: true, applied: false };
  return commitRequirementPlan(env, job.id, plan, new Set());
}

function sourceLabel(source) {
  if (source === CUSTOM_SOURCE) return "Custom";
  if (source === EMAIL_SOURCE) return "Email";
  return "Template";
}

function grouped(items) {
  const buckets = new Map(SECTIONS.map(section => [section, []]));
  (items || []).forEach(item => {
    const section = SECTIONS.includes(item.section) ? item.section : "shared";
    buckets.get(section).push(item);
  });
  return SECTIONS
    .map(section => ({ section, label: SECTION_LABELS[section], items: buckets.get(section).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.id).localeCompare(String(b.id))) }))
    .filter(group => group.items.length);
}

export function crewRequirementsHtml({ items } = {}) {
  const groups = grouped((items || []).filter(item => cleanLine(item && item.text)));
  if (!groups.length) return `<p class="req-empty">No requirements yet</p>`;
  return `<div class="req-crew">${groups.map(group => `<section class="req-sec"><h3>${esc(group.label)}</h3>${group.items.map(item => {
    const text = cleanLine(item.text);
    return `<label class="req-line"><input type="checkbox" data-req-tick="${esc(item.id)}" ${item.done ? "checked" : ""}> <span>${esc(text)}</span></label>`;
  }).join("")}</section>`).join("")}</div>`;
}

function optionList(pairs, selected) {
  return pairs.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
}

export function officeRequirementsHtml({ items, meta, editorName, job } = {}) {
  const groups = grouped(items || []);
  const storey = meta && STOREYS.includes(meta.storey) ? meta.storey : "";
  const stage = meta && CLEAN_STAGES.includes(meta.cleanStage) ? meta.cleanStage : "";
  const companyId = (job && job.companyId) || "heartwood";
  const heartwoodPacks = isHeartwoodCompany(companyId);
  const templateId = heartwoodPacks && meta && (meta.templateId === CORAL_TEMPLATE_ID || meta.templateId === HEARTWOOD_TEMPLATE_ID)
    ? meta.templateId
    : (heartwoodPacks && isCoralClient(job && job.client) ? CORAL_TEMPLATE_ID : (heartwoodPacks ? HEARTWOOD_TEMPLATE_ID : ""));
  const templateOptions = heartwoodPacks
    ? [["", "No template"], [HEARTWOOD_TEMPLATE_ID, "Heartwood"], [CORAL_TEMPLATE_ID, "Coral Homes"]]
    : [["", "No template"]];
  const notes = parseNotes(meta && meta.notes);
  const list = groups.length
    ? groups.map(group => `<section class="req-sec"><h3>${esc(group.label)}</h3>${group.items.map(item => {
      const text = cleanLine(item.text);
      return `<div class="req-line" data-req-id="${esc(item.id)}">
        <label><input type="checkbox" data-req-done="${esc(item.id)}" ${item.done ? "checked" : ""}> <span data-req-label>${esc(text)}</span></label>
        <span class="req-src">${esc(sourceLabel(item.source))}</span>
        <button type="button" class="sm-btn" data-req-up="${esc(item.id)}">Up</button>
        <button type="button" class="sm-btn" data-req-down="${esc(item.id)}">Down</button>
        <button type="button" class="sm-btn" data-req-edit="${esc(item.id)}">Edit</button>
        <button type="button" class="sm-btn" data-req-del="${esc(item.id)}">Delete</button>
      </div>`;
    }).join("")}</section>`).join("")
    : `<p class="req-empty">No requirements yet</p>`;
  const editor = meta && meta.updatedBy
    ? `<p class="req-editor">Last edited by ${esc(editorName || "Office")}</p>`
    : "";
  return `<div class="req-office">
    <div class="req-tools">
      <label>Template<select data-req-template>${optionList(templateOptions, templateId)}</select></label>
      <label>Storey<select data-req-storey>${optionList([["", "Not set"], ["single", "Single storey"], ["two", "Two storey"]], storey)}</select></label>
      <label>Stage<select data-req-stage>${optionList([["", "Not set"], ...CLEAN_STAGES.map(id => [id, CLEAN_STAGE_LABELS[id]])], stage)}</select></label>
      <button type="button" class="sm-btn primary" data-req-apply>Apply template</button>
    </div>
    ${editor}
    ${list}
    <div class="req-add">
      <label>Add a line<input data-req-new maxlength="500" placeholder="Requirement"></label>
      <label>Section<select data-req-new-section>${optionList(SECTIONS.map(id => [id, SECTION_LABELS[id]]), "shared")}</select></label>
      <button type="button" class="sm-btn" data-req-add>Add</button>
    </div>
    <h3>Notes</h3>
    ${NOTE_FIELDS.map(([key, label]) => `<label>${esc(label)}<input data-req-note="${key}" maxlength="400" value="${esc(notes[key] || "")}"></label>`).join("")}
    <button type="button" class="sm-btn" data-req-save-notes>Save notes</button>
  </div>`;
}

export function newRequirementId(fill) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(12);
  if (fill) fill(bytes);
  else if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = "rc";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

export function mountRequirements(root, job, api) {
  if (!root || !job || !job.id || !api) return () => {};
  let items = [];
  let meta = null;
  const paint = () => {
    const editorName = meta && meta.updatedBy && api.nameOf ? api.nameOf(meta.updatedBy) : "";
    root.innerHTML = api.office
      ? officeRequirementsHtml({ items, meta, editorName, job })
      : crewRequirementsHtml({ items });
  };
  const fail = err => {
    const message = (err && (err.message || err.code)) || "Not saved";
    if (api.toast) api.toast(message);
  };
  const onClick = ev => {
    const button = ev.target.closest("button");
    if (!button || !api.office) return;
    if (button.hasAttribute("data-req-apply")) {
      const template = root.querySelector("[data-req-template]");
      const storey = root.querySelector("[data-req-storey]");
      const stage = root.querySelector("[data-req-stage]");
      if (!template || (template.value !== CORAL_TEMPLATE_ID && template.value !== HEARTWOOD_TEMPLATE_ID)) {
        if (api.toast) api.toast("Choose a template first.");
        return;
      }
      const plan = planRequirementWrite({
        ...job,
        storey: storey ? storey.value : "",
        cleanStage: stage ? stage.value : "",
      }, items, {
        companyId: api.companyId,
        uid: api.uid,
        force: true,
        templateId: template.value,
        notes: notesFrom(root, meta),
      });
      api.commit(job.id, plan, new Set(items.map(item => item.id))).catch(fail);
      return;
    }
    if (button.hasAttribute("data-req-add")) {
      const input = root.querySelector("[data-req-new]");
      const section = root.querySelector("[data-req-new-section]");
      const text = cleanLine(input && input.value);
      if (!text) return;
      const item = {
        id: newRequirementId(),
        section: section && SECTIONS.includes(section.value) ? section.value : "shared",
        text,
        source: CUSTOM_SOURCE,
        sort: 900 + items.length,
        done: false,
        doneBy: "",
        doneAt: null,
      };
      api.commit(job.id, { apply: true, items: [item], deleteIds: [], meta: null, template: null }, new Set()).catch(fail);
      return;
    }
    if (button.hasAttribute("data-req-save-notes")) {
      api.saveMeta(job.id, metaPatch(root, meta, job)).catch(fail);
      return;
    }
    const id = button.getAttribute("data-req-edit") || button.getAttribute("data-req-del") || button.getAttribute("data-req-up") || button.getAttribute("data-req-down");
    const item = items.find(row => row.id === id);
    if (!item) return;
    if (button.hasAttribute("data-req-del")) {
      api.remove(job.id, item.id).catch(fail);
      return;
    }
    if (button.hasAttribute("data-req-edit")) {
      const row = button.closest("[data-req-id]");
      const label = row && row.querySelector("[data-req-label]");
      if (!label || row.querySelector("[data-req-input]")) return;
      const input = document.createElement("input");
      input.setAttribute("data-req-input", item.id);
      input.maxLength = 500;
      input.value = cleanLine(item.text);
      label.replaceWith(input);
      input.focus();
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      });
      input.addEventListener("blur", () => {
        const text = cleanLine(input.value);
        if (!text || text === cleanLine(item.text)) { paint(); return; }
        api.updateItem(job.id, item, { text, source: CUSTOM_SOURCE }).catch(fail);
      });
      return;
    }
    const dir = button.hasAttribute("data-req-up") ? -1 : 1;
    const ordered = items.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.id).localeCompare(String(b.id)));
    const index = ordered.findIndex(row => row.id === item.id);
    const swap = ordered[index + dir];
    if (!swap) return;
    const sort = Number.isFinite(+item.sort) ? +item.sort : index;
    const other = Number.isFinite(+swap.sort) ? +swap.sort : index + dir;
    Promise.all([
      api.updateItem(job.id, item, { sort: other }),
      api.updateItem(job.id, swap, { sort }),
    ]).catch(fail);
  };
  const onChange = ev => {
    const box = ev.target;
    if (!box || box.type !== "checkbox") return;
    const id = box.getAttribute("data-req-tick") || box.getAttribute("data-req-done");
    const item = items.find(row => row.id === id);
    if (!item) return;
    if (api.office) api.updateItem(job.id, item, { done: box.checked, doneBy: box.checked ? api.uid : "", doneAt: box.checked ? api.serverTimestamp() : null }).catch(fail);
    else api.tick(job.id, item, box.checked).catch(fail);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  const itemsRef = api.collection(api.db, "jobs", job.id, "requirementItems");
  const metaRef = api.doc(api.db, "jobs", job.id, "requirementMeta", "current");
  const unsubItems = api.onSnapshot(itemsRef, snap => {
    items = snap.docs.map(row => ({ id: row.id, ...row.data() }));
    paint();
  }, () => { items = []; paint(); });
  const unsubMeta = api.onSnapshot(metaRef, snap => {
    meta = snap.exists() ? snap.data() : null;
    paint();
  }, () => { meta = null; paint(); });
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    unsubItems();
    unsubMeta();
  };
}

function notesFrom(root, meta) {
  const fields = parseNotes(meta && meta.notes);
  root.querySelectorAll("[data-req-note]").forEach(input => {
    fields[input.getAttribute("data-req-note")] = input.value;
  });
  return formatNotes(fields);
}

function metaPatch(root, meta, job) {
  const storeyEl = root.querySelector("[data-req-storey]");
  const stageEl = root.querySelector("[data-req-stage]");
  const templateEl = root.querySelector("[data-req-template]");
  return {
    templateId: (templateEl && templateEl.value) || (meta && meta.templateId) || (isCoralClient(job.client) ? CORAL_TEMPLATE_ID : ""),
    builder: (meta && meta.builder) || (isCoralClient(job.client) ? CORAL_ALIAS : ""),
    storey: storeyEl ? storeyEl.value : (meta && meta.storey) || "",
    cleanStage: stageEl ? stageEl.value : (meta && meta.cleanStage) || "",
    notes: notesFrom(root, meta),
  };
}
