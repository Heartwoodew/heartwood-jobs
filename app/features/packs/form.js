// Measured-pack wizard markup. Data stays in each pack file. Dollars render only when the caller can see money.
import { linesForPackage, prettyUnit, RATE_LABEL } from "./money.js";

function fieldId(state, id) {
  const scope = state && state.sectionId ? String(state.sectionId) : "";
  return scope ? scope + "~" + id : id;
}

function numInput(groupId, field, label, value, esc, { step = "0.01", max = "" } = {}) {
  return `<label>${esc(label)}<input data-m="${esc(groupId)}" data-mf="${field}" type="number" min="0"${max ? ` max="${max}"` : ""} step="${step}" inputmode="decimal" value="${esc(value ?? "")}"></label>`;
}

function groupOf(lines) {
  const order = [];
  const map = new Map();
  for (const line of lines) {
    if (line.fromHours) continue;
    const id = line.group || line.id;
    if (!map.has(id)) { map.set(id, []); order.push(id); }
    map.get(id).push(line);
  }
  return order.map(id => map.get(id));
}

function selectedStyle(line, raw) {
  return (line.styles || []).find(s => s.id === (raw && raw.style)) || (line.styles || [])[0] || null;
}

function groupHtml(lines, state, esc) {
  const primary = lines[0];
  const logicalId = primary.group || primary.id;
  const groupId = fieldId(state, logicalId);
  const raw = (state.measures && (state.measures[logicalId] || state.measures[primary.id])) || {};
  const waste = raw.wastePct != null && raw.wastePct !== "" ? raw.wastePct : (primary.wastePct != null ? primary.wastePct : "");
  let fields = "";
  if (primary.styles) {
    const style = selectedStyle(primary, raw);
    const heights = style ? style.heights : [];
    const height = raw.height && heights.some(h => h.id === String(raw.height)) ? String(raw.height) : (heights[0] && heights[0].id);
    fields += `<label>${esc(primary.styleLabel || "Style")}<select data-m="${esc(groupId)}" data-mf="style">${primary.styles.map(s => `<option value="${esc(s.id)}" ${raw.style === s.id || (!raw.style && s === primary.styles[0]) ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>`;
    fields += `<label>${esc(primary.heightLabel || "Height")}<select data-m="${esc(groupId)}" data-mf="height">${heights.map(h => `<option value="${esc(h.id)}" ${height === h.id ? "selected" : ""}>${esc(h.label)}</option>`).join("")}</select></label>`;
  }
  if (primary.options) {
    const opt = raw.option && primary.options.some(o => o.id === raw.option) ? raw.option : primary.options[0].id;
    fields += `<label>${esc(primary.optionLabel || primary.label)}<select data-m="${esc(groupId)}" data-mf="option">${primary.options.map(o => `<option value="${esc(o.id)}" ${opt === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
  }
  if (primary.measure === "volume" || primary.measure === "area" || primary.measure === "linear") {
    fields += numInput(groupId, "length", "Length m", raw.length, esc);
  }
  if (primary.measure === "volume" || primary.measure === "area") {
    fields += numInput(groupId, "width", primary.widthLabel || "Width m", raw.width, esc);
  }
  if (primary.measure === "volume") fields += numInput(groupId, "depth", primary.depthLabel || "Depth m", raw.depth, esc);
  if (primary.measure === "hours" || primary.measure === "each") {
    fields += numInput(groupId, "qty", primary.qtyLabel || "Qty", raw.qty, esc, { step: primary.measure === "each" ? "1" : "0.25" });
  }
  if (primary.measure === "volume" || primary.measure === "area" || primary.measure === "linear") {
    fields += numInput(groupId, "wastePct", "Waste %", waste, esc, { step: "1", max: "100" });
  }
  const extras = lines.slice(1).map(line => {
    const own = (state.measures && state.measures[line.id]) || {};
    const on = own.on === true;
    const mid = fieldId(state, line.id);
    const choice = line.options ? `<label>${esc(line.label)}<select data-m="${esc(mid)}" data-mf="option">${line.options.map(o => `<option value="${esc(o.id)}" ${(own.option || (line.options[0] && line.options[0].id)) === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : "";
    return `<label class="ck"><input type="checkbox" data-mon="${esc(mid)}" ${on ? "checked" : ""}> ${esc(line.includeLabel || line.label)}</label>${choice}`;
  }).join("");
  const legend = primary.groupLabel || primary.label;
  return `<fieldset><legend>${esc(legend)}</legend><div class="qx-grid">${fields}</div>${extras}${primary.hint ? `<p class="sub">${esc(primary.hint)}</p>` : ""}</fieldset>`;
}

export function measureSetupHtml(pack, state, esc) {
  const pkg = state.packageId || (pack.packages[0] && pack.packages[0].id) || "";
  const pkgName = state.sectionId ? "package-" + state.sectionId : "package";
  const labourId = state.sectionId ? "qinclabour-" + state.sectionId : "qinclabour";
  const packages = pack.packages.length > 1 ? `<div class="qw-presets" role="radiogroup" aria-label="Package">${pack.packages.map(p => `<label class="ck qw-preset ${pkg === p.id ? "on" : ""}"><input type="radio" name="${esc(pkgName)}" data-secpkg="${esc(state.sectionId || "")}" value="${esc(p.id)}" ${pkg === p.id ? "checked" : ""}><span><b>${esc(p.label)}</b><small>${esc(p.blurb || "")}</small></span></label>`).join("")}</div>` : "";
  const groups = groupOf(linesForPackage(pack, pkg));
  return `<div class="qw-pane"><h4>${esc(pack.label)} measurements</h4>
    <p class="sub">${esc(pack.defaultsNote)}</p>
    ${packages}
    <div class="qw-measure">${groups.map(g => groupHtml(g, state, esc)).join("")}</div>
    <label class="ck"><input type="checkbox" id="${esc(labourId)}" data-seclabour="${esc(state.sectionId || "")}" ${state.includeLabour ? "checked" : ""}> Price the allocated hours on this quote</label>
    <p class="sub">Allocated hours are copied onto the job for the crew. They are not written to a timesheet, and nothing here is required before the job can be marked done.</p>
  </div>`;
}

export function measureReviewHtml(calc, esc, canSeeMoney, canEdit) {
  if (!calc.ok) return `<div class="qw-pane"><p class="err">${esc(calc.reason)}</p></div>`;
  const rows = (calc.lines || []).filter(l => String(l.baseKey || l.key || "").startsWith("pack:")).map(l => {
    const money = canSeeMoney ? `<div class="qx-grid"><label>$ / ${esc(prettyUnit(l.unit))} ex GST<input data-packprice="${esc(l.rateKey)}" data-packbase="${esc(l.baseRate ?? "")}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(l.rate ?? "")}"></label></div>
      <span class="qw-flag" data-packflag data-packidle="${esc(l.idleLabel || RATE_LABEL.default)}">${esc(l.rateLabel || RATE_LABEL[l.rateSource] || "")}</span>
      ${canEdit ? `<p class="qx-scope sub" data-packscope="${esc(l.rateKey)}" ${l.rateSource === "quote" ? "" : "hidden"}>This price changed. <button type="button" class="sm-btn" data-packonly="${esc(l.rateKey)}">This quote only</button> <button type="button" class="sm-btn" data-packdefault="${esc(l.rateKey)}">Save as company default</button></p>` : ""}` : "";
    return `<div class="qx-row" data-packrow="${esc(l.rateKey)}"><div class="qx-head"><span>${esc(l.label)}</span></div>${money}</div>`;
  }).join("");
  return `<div class="qw-pane"><h4>Review</h4>
    <p class="sub">These prices are starting-point defaults to review (A$ ex GST) until this company saves its own. GST is added once, at 10%, on the review total.</p>
    ${rows || `<p class="sub">No quantities yet. Go back and enter a measurement.</p>`}
  </div>`;
}
