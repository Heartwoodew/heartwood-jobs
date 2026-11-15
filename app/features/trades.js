// CallUp trades, job titles and quote packs.
// Sign-up stores a list of trades. An older company with only `trade` still reads that one trade.
// A company with neither reads as ["earthworks"] (Heartwood, callup-test-h2vx, anyone else). Nothing here writes.

// Earthworks is the only quote pack with the plant wizard. Other trades contribute job titles and job types
// and are marked quote-pack coming soon. No mix design, no assignment filtering, no sign-off flag.

export const DEFAULT_TRADE = "earthworks";
export const LAZY_EARTHWORKS_IDS = Object.freeze(["heartwood", "callup-test-h2vx"]);

export const TRADES = Object.freeze([
  { id: "earthworks", label: "Earthworks" },
  { id: "landscaping", label: "Landscaping" },
  { id: "concreting", label: "Concreting" },
  { id: "fencing", label: "Fencing" },
  { id: "carpentry", label: "Carpentry" },
  { id: "tiling", label: "Tiling" },
  { id: "plumbing", label: "Plumbing" },
  { id: "electrical", label: "Electrical" },
]);

export const TRADE_IDS = Object.freeze(TRADES.map(t => t.id));

export const PERMISSION_LEVELS = Object.freeze(["labourer", "operator", "supervisor", "manager", "admin"]);
const LEVEL_RANK = Object.freeze({ labourer: 0, operator: 1, supervisor: 2, manager: 3, admin: 4 });

export const LINE_TYPES = Object.freeze([
  ["labour", "Labour"],
  ["material", "Material"],
  ["compliance", "Compliance"],
  ["hire", "Hire"],
  ["waste", "Waste"],
]);

const LINE_TYPE_IDS = LINE_TYPES.map(([id]) => id);

// Preloaded names. The permission level comes from levelForTitleName so the mapping stays one place.
const TITLE_NAMES = Object.freeze({
  earthworks: ["Operations manager", "Project manager", "Leading hand", "Operator", "Excavator operator", "Skid-steer operator", "Truck driver", "Labourer", "Admin"],
  landscaping: ["Operations manager", "Project manager", "Leading hand", "Landscaper", "Machine operator", "Labourer"],
  concreting: ["Operations manager", "Project manager", "Leading hand", "Concreter", "Steel fixer", "Formworker", "Labourer"],
  fencing: ["Operations manager", "Project manager", "Leading hand", "Fencer", "Labourer"],
  carpentry: ["Operations manager", "Project manager", "Leading hand", "Carpenter", "Joiner", "Formworker", "Apprentice carpenter", "Labourer"],
  tiling: ["Operations manager", "Project manager", "Leading tiler", "Tiler", "Apprentice tiler", "Labourer"],
  plumbing: ["Operations manager", "Project manager", "Licensed plumber", "Drainer", "Gas fitter", "Roof plumber", "Apprentice plumber", "Labourer"],
  electrical: ["Operations manager", "Project manager", "Licensed electrician", "Apprentice electrician", "Electrical trades assistant"],
});

const EARTHWORKS_TYPES = Object.freeze([
  ["spoil", "Spoil removal"],
  ["backslab", "Backslab"],
  ["waterproof", "Waterproofing"],
  ["clean", "Site clean"],
  ["other", "Other"],
]);

const OTHER_TYPES = Object.freeze({
  landscaping: [["ls-garden", "Garden build"], ["ls-turf", "Turf"], ["ls-paving", "Paving"], ["ls-retaining", "Retaining"], ["ls-maintain", "Maintenance"], ["ls-other", "Other"]],
  concreting: [["co-slab", "Slab"], ["co-driveway", "Driveway"], ["co-footing", "Footings"], ["co-path", "Paths"], ["co-other", "Other"]],
  fencing: [["fe-timber", "Timber fence"], ["fe-colorbond", "Colorbond fence"], ["fe-gate", "Gate"], ["fe-other", "Other"]],
  carpentry: [["ca-frame", "Framing"], ["ca-fitout", "Fit-out"], ["ca-deck", "Deck"], ["ca-other", "Other"]],
  tiling: [["ti-floor", "Floor tiling"], ["ti-wall", "Wall tiling"], ["ti-waterproof", "Waterproofing"], ["ti-other", "Other"]],
  plumbing: [["pl-rough", "Rough-in"], ["pl-fitoff", "Fit-off"], ["pl-drain", "Drainage"], ["pl-gas", "Gas"], ["pl-other", "Other"]],
  electrical: [["el-rough", "Rough-in"], ["el-fitoff", "Fit-off"], ["el-fault", "Fault finding"], ["el-other", "Other"]],
});

// Earthworks pack is today's plant wizard and extras, described as data. Behaviour stays in quotes.js.
const EARTHWORKS_TEMPLATES = Object.freeze([
  { id: "truck_skid", label: "Truck + skid steer", lineType: "hire" },
  { id: "truck_excavator", label: "Truck + excavator", lineType: "hire" },
  { id: "truck_skid_excavator", label: "Truck + skid steer + excavator", lineType: "hire" },
  { id: "excavator", label: "Excavator only", lineType: "hire" },
]);

const EARTHWORKS_LINES = Object.freeze([
  { id: "labourer", label: "Labourer", lineType: "labour" },
  { id: "travel", label: "Travel", lineType: "hire" },
  { id: "material", label: "Materials", lineType: "material" },
  { id: "tip", label: "Rubbish / tip", lineType: "waste" },
  { id: "rubbish", label: "Rubbish removal", lineType: "waste" },
  { id: "concrete", label: "Concrete removal", lineType: "waste" },
  { id: "compliance", label: "Compliance", lineType: "compliance" },
]);

const KIND_LINE = Object.freeze({
  rubbish: "waste", concrete: "waste", material: "material", tip: "waste", travel: "hire", misc: "labour", custom: "labour",
});

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function tradeById(id) {
  return TRADES.find(t => t.id === id) || null;
}

export function tradeLabel(id) {
  return (tradeById(id) || {}).label || "";
}

export function normalizeTrade(id) {
  const s = String(id || "").trim().toLowerCase();
  return TRADE_IDS.includes(s) ? s : "";
}

/** Project / operations manager -> manager; leading hand / leading tiler -> supervisor; apprentices, labourers and trades assistants -> labourer; Admin -> admin; licensed trades, operators and drivers -> operator. */
export function levelForTitleName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return "";
  if (n === "admin") return "admin";
  if (n.includes("operations manager") || n.includes("project manager")) return "manager";
  if (n.startsWith("leading ") || n.includes("leading hand")) return "supervisor";
  if (n.includes("apprentice") || n === "labourer" || n.includes("labourer") || n.includes("trades assistant")) return "labourer";
  return "operator";
}

function slug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function sanitizeTradeList(list) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const trade = normalizeTrade(id);
    if (!trade || out.includes(trade)) continue;
    out.push(trade);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Same job title from more than one trade.
 * The first trade in the company list is the higher-trust mapping.
 * Use it only when it does not outrank the others. Otherwise use the lower level and say so.
 */
export function chooseTitleLevel(name, options) {
  const rows = (options || []).filter(row => row && PERMISSION_LEVELS.includes(row.level));
  if (!rows.length) return { level: levelForTitleName(name) || "labourer", levelNote: "" };
  const trusted = rows[0];
  const lowest = rows.reduce((a, b) => LEVEL_RANK[a.level] <= LEVEL_RANK[b.level] ? a : b);
  const distinct = [...new Set(rows.map(row => row.level))];
  if (distinct.length === 1) return { level: trusted.level, levelNote: "" };
  const listed = rows.map(row => `${tradeLabel(row.trade) || row.trade} ${row.level}`).join(", ");
  if (LEVEL_RANK[trusted.level] <= LEVEL_RANK[lowest.level]) {
    return { level: trusted.level, levelNote: `Kept ${trusted.level} from the primary trade. Also listed as ${listed}.` };
  }
  return { level: lowest.level, levelNote: `Using ${lowest.level}. A higher level (${listed}) was not applied.` };
}

export function defaultTitles(tradeIds) {
  const ids = sanitizeTradeList(tradeIds);
  const grouped = new Map();
  for (const trade of ids) {
    for (const name of TITLE_NAMES[trade] || []) {
      const key = name.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, { name, options: [] });
      grouped.get(key).options.push({ trade, level: levelForTitleName(name) });
    }
  }
  const out = [];
  for (const group of grouped.values()) {
    const chosen = chooseTitleLevel(group.name, group.options);
    const trade = group.options[0].trade;
    const row = { id: trade + ":" + slug(group.name), name: group.name, level: chosen.level, trade, custom: false };
    if (chosen.levelNote) row.levelNote = chosen.levelNote;
    out.push(row);
  }
  return out;
}

export function titlesAfterTradeChange(previousTitles, saved, tradeIds) {
  const base = defaultTitles(tradeIds);
  if (!saved) return base;
  const custom = sanitizeTitles(previousTitles).filter(row => row.custom);
  const names = new Set(custom.map(row => row.name.toLowerCase()));
  return [...base.filter(row => !names.has(row.name.toLowerCase())), ...custom];
}

function cleanName(name) {
  const raw = String(name ?? "");
  if (/[\n\r\t<>]/.test(raw)) return "";
  const s = raw.trim().replace(/ +/g, " ");
  if (!s || s.length > 80) return "";
  return s;
}

export function sanitizeTitles(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const row of list.slice(0, 80)) {
    if (!row || typeof row !== "object") continue;
    const name = cleanName(row.name);
    const level = PERMISSION_LEVELS.includes(row.level) ? row.level : "";
    const trade = normalizeTrade(row.trade) || DEFAULT_TRADE;
    if (!name || !level) continue;
    const levelNote = typeof row.levelNote === "string" && row.levelNote.trim() && row.levelNote.length <= 200 && !/[\n\r\t<>]/.test(row.levelNote)
      ? row.levelNote.trim() : "";
    let id = String(row.id || "").replace(/[^a-z0-9:_-]/gi, "").slice(0, 60);
    if (!id) id = (row.custom ? "custom:" : trade + ":") + slug(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const item = { id, name, level, trade, custom: row.custom === true };
    if (levelNote) item.levelNote = levelNote;
    out.push(item);
  }
  return out;
}

export function addTitle(titles, { name, level, trade } = {}) {
  const next = sanitizeTitles(titles);
  const clean = cleanName(name);
  const lvl = PERMISSION_LEVELS.includes(level) ? level : "";
  if (!clean || !lvl) return { ok: false, reason: !clean ? "name" : "level", titles: next };
  if (next.some(t => t.name.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "duplicate", titles: next };
  const id = "custom:" + slug(clean) + "-" + (next.length + 1);
  next.push({ id, name: clean, level: lvl, trade: normalizeTrade(trade) || DEFAULT_TRADE, custom: true });
  return { ok: true, titles: next };
}

export function renameTitle(titles, id, name) {
  const next = sanitizeTitles(titles);
  const clean = cleanName(name);
  const row = next.find(t => t.id === id);
  if (!row || !clean) return { ok: false, reason: !clean ? "name" : "missing", titles: next };
  if (next.some(t => t.id !== id && t.name.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "duplicate", titles: next };
  row.name = clean;
  return { ok: true, titles: next };
}

export function setTitleLevel(titles, id, level) {
  const next = sanitizeTitles(titles);
  const row = next.find(t => t.id === id);
  if (!row || !PERMISSION_LEVELS.includes(level)) return { ok: false, reason: "level", titles: next };
  row.level = level;
  return { ok: true, titles: next };
}

export function removeTitle(titles, id) {
  const next = sanitizeTitles(titles).filter(t => t.id !== id);
  if (next.length === sanitizeTitles(titles).length) return { ok: false, reason: "missing", titles: next };
  return { ok: true, titles: next };
}

function pack(id, jobTypes, ready) {
  return Object.freeze({
    id,
    label: tradeLabel(id),
    ready: ready === true,
    wizard: ready ? "plant" : "",
    soon: ready ? "" : "Quote pack coming soon",
    jobTypes: Object.freeze(jobTypes.map(row => Object.freeze([...row]))),
    templates: ready ? EARTHWORKS_TEMPLATES : Object.freeze([]),
    lineItems: ready ? EARTHWORKS_LINES : Object.freeze([]),
  });
}

export const QUOTE_PACKS = Object.freeze({
  earthworks: pack("earthworks", EARTHWORKS_TYPES, true),
  landscaping: pack("landscaping", OTHER_TYPES.landscaping, false),
  concreting: pack("concreting", OTHER_TYPES.concreting, false),
  fencing: pack("fencing", OTHER_TYPES.fencing, false),
  carpentry: pack("carpentry", OTHER_TYPES.carpentry, false),
  tiling: pack("tiling", OTHER_TYPES.tiling, false),
  plumbing: pack("plumbing", OTHER_TYPES.plumbing, false),
  electrical: pack("electrical", OTHER_TYPES.electrical, false),
});

export function quotePack(id) {
  return QUOTE_PACKS[normalizeTrade(id)] || null;
}

export function sanitizeExtraTrades(list, main) {
  const primary = normalizeTrade(main) || DEFAULT_TRADE;
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const trade = normalizeTrade(id);
    if (!trade || trade === primary || out.includes(trade)) continue;
    out.push(trade);
    if (out.length >= 7) break;
  }
  return out;
}

/** List of trades. `trades` wins, then the old single `trade`, then earthworks. Does not write. */
export function readTradeList(company, stored) {
  const listed = sanitizeTradeList(company && company.trades);
  if (listed.length) return listed;
  const storedList = sanitizeTradeList(stored && stored.trades);
  if (storedList.length) return storedList;
  const primary = normalizeTrade(company && company.trade) || normalizeTrade(stored && stored.trade);
  const extras = sanitizeExtraTrades((stored && stored.extraTrades) || (company && company.extraTrades), primary || DEFAULT_TRADE);
  if (primary) return [primary, ...extras];
  return [DEFAULT_TRADE];
}

/** Lazy read. No trade stored -> ['earthworks']. Does not write. */
export function resolveCompanySetup(company, stored) {
  const enabled = readTradeList(company, stored);
  const trade = enabled[0];
  const extraTrades = enabled.slice(1);
  const saved = !!(stored && Array.isArray(stored.titles) && stored.titles.length);
  const titles = saved ? sanitizeTitles(stored.titles) : defaultTitles(enabled);
  return { trade, extraTrades, enabled, titles, saved, companyId: (company && company.companyId) || (stored && stored.companyId) || "" };
}

export function jobTypeMap(setup) {
  const out = {};
  const ids = setup && Array.isArray(setup.enabled) && setup.enabled.length ? setup.enabled : [DEFAULT_TRADE];
  for (const id of ids) {
    const row = quotePack(id);
    if (!row) continue;
    for (const [key, label] of row.jobTypes) out[key] = label;
  }
  if (!Object.keys(out).length) {
    for (const [key, label] of EARTHWORKS_TYPES) out[key] = label;
  }
  return out;
}

export function readyJobTypeMap(setup) {
  if (!setup) return null;
  const out = {};
  for (const id of setup.enabled || []) {
    const row = quotePack(id);
    if (!row || !row.ready) continue;
    for (const [key, label] of row.jobTypes) out[key] = label;
  }
  return out;
}

export function packForType(typeId, setup) {
  const key = String(typeId || "");
  const ids = setup && setup.enabled ? setup.enabled : [DEFAULT_TRADE];
  for (const id of ids) {
    const row = quotePack(id);
    if (row && row.jobTypes.some(([k]) => k === key)) return row;
  }
  return null;
}

export function soonTradeLabels(setup) {
  return (setup && setup.enabled || []).filter(id => {
    const row = quotePack(id);
    return row && !row.ready;
  }).map(tradeLabel).filter(Boolean);
}

export function lineTypeForKind(kind) {
  return KIND_LINE[kind] || "labour";
}

export function normalizeLineType(value, kind) {
  return LINE_TYPE_IDS.includes(value) ? value : lineTypeForKind(kind);
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Area m², volume m³, linear metre, then waste %. No mix design. */
export function measureQty({ measure, length, width, depth, wastePct } = {}) {
  const kind = String(measure || "");
  let base = null;
  if (kind === "area") {
    const a = num(length), b = num(width);
    if (a == null || b == null) return { ok: false, reason: "Enter length and width in metres." };
    base = a * b;
  } else if (kind === "volume") {
    const a = num(length), b = num(width), c = num(depth);
    if (a == null || b == null || c == null) return { ok: false, reason: "Enter length, width and depth in metres." };
    base = a * b * c;
  } else if (kind === "linear") {
    const a = num(length);
    if (a == null) return { ok: false, reason: "Enter the length in metres." };
    base = a;
  } else return { ok: false, reason: "Choose area, volume or linear metre." };
  const waste = num(wastePct);
  const pct = waste == null ? 0 : Math.min(100, waste);
  const qty = Math.round(base * (1 + pct / 100) * 1000) / 1000;
  return { ok: true, qty, base: Math.round(base * 1000) / 1000, wastePct: pct, unit: kind === "linear" ? "m" : kind === "volume" ? "m3" : "m2" };
}

export const RATE_SAVE_QUOTE = "quote";
export const RATE_SAVE_COMPANY = "company";

export function rateSaveChoice(choice) {
  return choice === RATE_SAVE_COMPANY ? RATE_SAVE_COMPANY : RATE_SAVE_QUOTE;
}

export function sanitizeSkills(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list.slice(0, 24)) {
    const s = String(raw ?? "").trim().replace(/ +/g, " ").slice(0, 40);
    if (!s || /[\n\r\t<>]/.test(s)) continue;
    if (out.some(x => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

export function companyTradesDoc(companyId, tradeOrList, uid) {
  const list = sanitizeTradeList(Array.isArray(tradeOrList) ? tradeOrList : [tradeOrList]);
  const trades = list.length ? list : [DEFAULT_TRADE];
  return {
    companyId,
    trade: trades[0],
    trades,
    extraTrades: trades.slice(1),
    titles: defaultTitles(trades),
    updatedBy: uid || "",
  };
}

export function signupTradesHtml(selected = [DEFAULT_TRADE]) {
  const on = new Set(sanitizeTradeList(selected).length ? sanitizeTradeList(selected) : [DEFAULT_TRADE]);
  return `<fieldset class="tradepick"><legend>Trades</legend>
    <p class="sub">Choose every trade this company does. At least one. Earthworks includes the plant quote wizard. The first ticked trade is the one quotes open on.</p>
    ${TRADES.map(t => `<label class="ck"><input type="checkbox" name="trades" value="${esc(t.id)}"${on.has(t.id) ? " checked" : ""}> ${esc(t.label)}${quotePack(t.id) && quotePack(t.id).ready ? "" : " <span class=\"sub\">quote pack coming soon</span>"}</label>`).join("")}
  </fieldset>`;
}

export function tradeSelectHtml(selected = DEFAULT_TRADE) {
  const cur = normalizeTrade(selected) || DEFAULT_TRADE;
  return TRADES.map(t => `<option value="${esc(t.id)}"${t.id === cur ? " selected" : ""}>${esc(t.label)}</option>`).join("");
}

export function titlesEditorHtml(titles, { canEdit = false } = {}) {
  const rows = sanitizeTitles(titles);
  const levelOpts = (cur) => PERMISSION_LEVELS.map(id => `<option value="${id}"${id === cur ? " selected" : ""}>${esc(id.charAt(0).toUpperCase() + id.slice(1))}</option>`).join("");
  const body = rows.map(t => `<li class="title-row" data-title="${esc(t.id)}">
      ${canEdit
        ? `<input data-title-name value="${esc(t.name)}" maxlength="80" aria-label="Job title">
           <select data-title-level aria-label="Permission level">${levelOpts(t.level)}</select>
           <button type="button" class="sm-btn" data-title-rename="${esc(t.id)}">Rename</button>
           <button type="button" class="sm-btn" data-title-remove="${esc(t.id)}">Remove</button>`
        : `<b>${esc(t.name)}</b> <span class="sub">${esc(t.level)}</span>`}
      ${t.levelNote ? `<p class="sub">${esc(t.levelNote)}</p>` : ""}
    </li>`).join("");
  const form = canEdit ? `<form id="titleadd" class="jf title-add">
      <label>New job title<input name="name" maxlength="80" required placeholder="e.g. Site clerk"></label>
      <label>Permission level<select name="level">${levelOpts("operator")}</select></label>
      <button type="submit" class="sm-btn primary">Add title</button>
      <p id="titleerr" class="err"></p>
    </form>` : `<p class="sub">An admin or a manager can add, rename and remove titles.</p>`;
  return `<section class="card title-editor" id="titleeditor">
    <h2>Job titles</h2>
    <p class="sub">A job title sets the permission level on an invite. Existing staff keep the level already on their profile.</p>
    <ul class="title-list">${body || `<li class="muted">No titles yet.</li>`}</ul>
    ${form}
  </section>`;
}

function unselectedTradeOptions(selected) {
  const on = new Set(sanitizeTradeList(selected));
  return TRADES.filter(t => !on.has(t.id)).map(t => {
    const row = quotePack(t.id);
    const soon = row && row.ready ? "" : " — quote pack coming soon";
    return `<option value="${esc(t.id)}">${esc(t.label)}${esc(soon)}</option>`;
  }).join("");
}

export function quoteTradeSwitchHtml(setup, focus) {
  const ids = (setup && setup.enabled) || [DEFAULT_TRADE];
  const cur = ids.includes(focus) ? focus : ids[0];
  return `<label class="pad">Quote trade<select id="quotetrade" aria-label="Quote trade">${ids.map(id => {
    const row = quotePack(id);
    const soon = row && row.ready ? "" : " — quote pack coming soon";
    return `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(tradeLabel(id))}${esc(soon)}</option>`;
  }).join("")}</select></label>
    <p class="sub pad">Quotes open on ${esc(tradeLabel(ids[0]))}. This switch only changes the quote. Job types on a job include every selected trade.</p>`;
}

export function tradeSettingsHtml(trades, { canEdit = false } = {}) {
  const selected = sanitizeTradeList(trades);
  const list = selected.length ? selected : [DEFAULT_TRADE];
  const rows = list.map((id, i) => {
    const row = quotePack(id);
    const flag = row && row.ready ? "Quote pack ready" : "Quote pack coming soon";
    return `<li><b>${esc(tradeLabel(id))}</b> ${i === 0 ? `<span class="sub">Primary</span>` : ""} <span class="sub">${esc(flag)}</span>
      ${canEdit && list.length > 1 ? `<button type="button" class="sm-btn" data-trade-remove="${esc(id)}">Remove</button>` : ""}</li>`;
  }).join("");
  const options = unselectedTradeOptions(list);
  const add = canEdit && options ? `<form id="tradeset" class="jf">
      <label>Add a trade<select name="trade"><option value="">Choose a trade</option>${options}</select></label>
      <button type="submit" class="sm-btn">Add trade</button>
    </form>` : (canEdit ? `<p class="sub">Every trade is already on this company.</p>` : `<p class="sub">An admin or a manager can add or remove trades. Company details and billing stay with an admin.</p>`);
  return `<section class="card trade-settings" id="tradesettings">
    <h2>Trades</h2>
    <p class="sub">Job titles, job types and quote packs are the combination of these trades. Quotes start on the primary trade.</p>
    <ul class="trade-list">${rows}</ul>
    ${add}
  </section>`;
}

export function tradeToolsHtml(setup, { canEdit = false, focus = "" } = {}) {
  const selected = (setup && setup.enabled) || [DEFAULT_TRADE];
  const options = unselectedTradeOptions(selected);
  const add = canEdit && options ? `<form id="tradeadd" class="jf">
      <label>Use another trade<select name="trade"><option value="">Choose a trade</option>${options}</select></label>
      <button type="submit" class="sm-btn">Add trade</button>
      <p class="sub">Only trades that are not already on this company are listed.</p>
    </form>` : "";
  return `<section class="card trade-tools" id="tradetools">
    <h2>Trades on quotes</h2>
    ${quoteTradeSwitchHtml(setup, focus)}
    ${add}
  </section>`;
}

export function skillsEditorHtml(skills, { canEdit = true } = {}) {
  const tags = sanitizeSkills(skills);
  const pills = tags.map(tag => `<span class="skill-tag">${esc(tag)}${canEdit ? ` <button type="button" data-skill-remove="${esc(tag)}" aria-label="Remove ${esc(tag)}">×</button>` : ""}</span>`).join("");
  const form = canEdit ? `<form id="skilladd" class="skill-add"><input name="skill" maxlength="40" placeholder="e.g. White card, HR licence, first aid" aria-label="Skill or licence"><button type="submit" class="sm-btn">Add</button></form>` : "";
  return `<section class="card skill-editor" id="skilleditor">
    <h2>Skills and licences</h2>
    <p class="sub">Optional notes on this person. They do not block a job being assigned or marked done.</p>
    <div class="skill-tags">${pills || `<span class="sub">None yet.</span>`}</div>
    ${form}
  </section>`;
}

export function quotePackNote(setup) {
  const soon = soonTradeLabels(setup);
  const ready = (setup && setup.enabled || []).filter(id => quotePack(id) && quotePack(id).ready).map(tradeLabel);
  if (!setup) return "";
  const readyTxt = ready.length ? ready.join(", ") : "none yet";
  const soonTxt = soon.length ? ` ${soon.join(", ")}: quote pack coming soon.` : "";
  return `<p class="pad sub">Quote pack ready: ${esc(readyTxt)}.${esc(soonTxt)} Earthworks uses the plant wizard and extras. Other packs are titles and job types until their quote pack is added.</p>`;
}
