// Shared measure and money helpers for quote packs.
// Area, volume and linear metre match the sprint helper (waste % capped at 100, quantity to 3 decimals).
// GST is whole cents, and half a cent rounds up, the same way the earthworks quote total does.
// Placeholder rates are starting points. A company rate or a this-quote price replaces them.

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function roundQty(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** GST in whole cents. 10.35 ex GST → 1.04, not the 1.03 float maths would give. */
export function gstFromEx(totalEx) {
  if (totalEx == null || !Number.isFinite(+totalEx)) return { gst: null, totalInc: null };
  const ex = roundMoney(totalEx);
  const gst = Math.round(Math.round(ex * 100) / 10) / 100;
  return { gst, totalInc: roundMoney(ex + gst) };
}

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

export function priceOrNull(v) {
  if (v === "" || v == null || !Number.isFinite(+v)) return null;
  const n = Math.round(+v * 100) / 100;
  if (n < 0) return null;
  return Math.min(1000000, n);
}

/** Quote price wins, then the company default, then the placeholder. */
export function resolveRate(defaultRate, companyRate, quoteRate) {
  const quote = priceOrNull(quoteRate);
  if (quote != null) return { rate: quote, source: "quote" };
  const company = priceOrNull(companyRate);
  if (company != null) return { rate: company, source: "company" };
  const placeholder = priceOrNull(defaultRate);
  if (placeholder != null) return { rate: placeholder, source: "default" };
  return { rate: null, source: "missing" };
}

export const RATE_LABEL = Object.freeze({
  default: "Default to review",
  company: "Company default",
  quote: "This quote only",
  missing: "Price missing",
});

export const UNIT_PRETTY = Object.freeze({ m2: "m²", m3: "m³", m: "m", h: "h", each: "each" });

export function prettyUnit(unit) {
  return UNIT_PRETTY[unit] || unit || "";
}

export function linesForPackage(pack, packageId) {
  const id = packageId || (pack.packages[0] && pack.packages[0].id) || "";
  return pack.lines.filter(line => {
    const p = line.package || "shared";
    if (p === "shared") return true;
    if (id === "both") return true;
    return p === id;
  });
}

export function defaultMeasures(pack) {
  const out = {};
  for (const line of pack.lines) {
    const group = line.group || line.id;
    if (line.styles) {
      const style = line.styles[0];
      const height = style.heights.find(h => h.id === "1.8") || style.heights[0];
      out[group] = { style: style.id, height: height.id };
    }
    if (line.defaultOn) {
      out[line.id] = { ...(out[line.id] || {}), on: true };
      if (line.options && line.options[0]) out[line.id].option = line.options[0].id;
    }
  }
  return out;
}

export function sanitizeQuotePrices(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [k, v] of Object.entries(map).slice(0, 40)) {
    if (!/^[a-z0-9:@._-]{1,40}$/i.test(k)) continue;
    const n = priceOrNull(v);
    if (n != null) out[k] = n;
  }
  return out;
}

function isBlank(measure, raw) {
  const r = raw || {};
  const fields = measure === "volume" ? ["length", "width", "depth"]
    : measure === "area" ? ["length", "width"]
    : measure === "linear" ? ["length"]
    : ["qty"];
  return fields.every(k => r[k] === "" || r[k] == null);
}

function readRaw(line, measures) {
  const group = line.group || line.id;
  const shared = (measures && measures[group]) || {};
  const own = (measures && measures[line.id]) || {};
  const wastePct = own.wastePct != null && own.wastePct !== "" ? own.wastePct
    : (shared.wastePct != null && shared.wastePct !== "" ? shared.wastePct : line.wastePct);
  return {
    length: shared.length, width: shared.width, depth: shared.depth,
    qty: own.qty != null && own.qty !== "" ? own.qty : shared.qty,
    wastePct, style: own.style || shared.style, height: own.height || shared.height,
    option: own.option || shared.option, on: own.on === true,
  };
}

function priceKey(line, raw) {
  if (line.styles) {
    const style = line.styles.find(s => s.id === raw.style) || null;
    if (!style) return { error: "Choose a fence style." };
    const height = style.heights.find(h => h.id === String(raw.height || "")) || null;
    if (!height) return { error: "Choose a fence height." };
    return { key: line.id + ":" + style.id + "@" + height.id, defaultRate: height.defaultRate, extra: style.label + ", " + height.label };
  }
  if (line.options) {
    const opt = line.options.find(o => o.id === raw.option) || null;
    if (!opt) return { error: "Choose a " + line.label.toLowerCase() + "." };
    return { key: line.id + ":" + opt.id, defaultRate: opt.defaultRate, extra: opt.label };
  }
  return { key: line.id, defaultRate: line.defaultRate, extra: "" };
}

function pushLine(lines, line, qty, unit, priced, extra) {
  const name = line.label + (extra ? " — " + extra : "");
  const amount = priced.rate == null ? null : roundMoney(qty * priced.rate);
  lines.push({
    key: "pack:" + priced.key,
    id: line.id,
    rateKey: priced.key,
    name,
    label: `${name} (${qty} ${prettyUnit(unit)})`,
    qty, unit, rate: priced.rate, rateSource: priced.source, rateLabel: RATE_LABEL[priced.source] || "",
    idleLabel: priced.idleLabel || RATE_LABEL.default,
    baseRate: priced.baseRate, defaultRate: priced.defaultRate, lineType: line.lineType,
    amount, note: line.note || "",
  });
}

/**
 * Price one measured pack. Blank lines are left out. A half-filled measure is an error.
 * No mix design: extra keys on a measure (mpa, cement, and the rest) are ignored.
 */
export function calcMeasured(pack, input, companyRates) {
  const data = input || {};
  const measures = data.measures || {};
  const quotes = data.quotePrices || {};
  const company = companyRates || {};
  const visible = new Set(linesForPackage(pack, data.packageId).map(line => line.id));
  const lines = [];
  for (const line of pack.lines) {
    if (!visible.has(line.id) || line.fromHours) continue;
    const raw = readRaw(line, measures);
    const own = measures && measures[line.id];
    const explicit = !!(own && Object.prototype.hasOwnProperty.call(own, "on"));
    const on = explicit ? own.on === true : line.defaultOn === true;
    if (line.optional && !on) continue;
    if (line.options && !raw.option && line.options[0]) raw.option = line.options[0].id;
    if (line.styles && !raw.style && line.styles[0]) {
      raw.style = line.styles[0].id;
      const pick = line.styles[0].heights.find(h => h.id === "1.8") || line.styles[0].heights[0];
      if (!raw.height && pick) raw.height = pick.id;
    }
    if (isBlank(line.measure, raw)) continue;
    let measured;
    if (line.measure === "hours" || line.measure === "each") {
      const q = num(raw.qty);
      if (q == null) return fail(pack, "Enter a quantity for " + line.label + ".");
      measured = { ok: true, qty: roundQty(q), unit: line.unit };
    } else {
      measured = measureQty({
        measure: line.measure, length: raw.length, width: raw.width, depth: raw.depth, wastePct: raw.wastePct,
      });
      if (!measured.ok) return fail(pack, line.label + ": " + measured.reason);
      if (line.unit) measured = { ...measured, unit: line.unit };
    }
    if (!(measured.qty > 0)) continue;
    const keyed = priceKey(line, raw);
    if (keyed.error) return fail(pack, keyed.error);
    const priced = resolveRate(keyed.defaultRate, company[keyed.key], quotes[keyed.key]);
    const companyOrDefault = priceOrNull(company[keyed.key]);
    priced.baseRate = companyOrDefault != null ? companyOrDefault : priceOrNull(keyed.defaultRate);
    priced.defaultRate = priceOrNull(keyed.defaultRate);
    priced.idleLabel = priceOrNull(company[keyed.key]) != null ? "Company default" : "Default to review";
    priced.key = keyed.key;
    pushLine(lines, line, measured.qty, measured.unit, priced, keyed.extra);
  }
  if (data.includeLabour) {
    const hours = num(data.hoursOnSite);
    const labour = pack.lines.find(line => line.fromHours && visible.has(line.id));
    if (labour && hours) {
      const priced = resolveRate(labour.defaultRate, company[labour.id], quotes[labour.id]);
      const companyOrDefault = priceOrNull(company[labour.id]);
      priced.baseRate = companyOrDefault != null ? companyOrDefault : priceOrNull(labour.defaultRate);
      priced.defaultRate = priceOrNull(labour.defaultRate);
      priced.idleLabel = priceOrNull(company[labour.id]) != null ? "Company default" : "Default to review";
      priced.key = labour.id;
      pushLine(lines, labour, roundQty(hours), labour.unit, priced, "");
    }
  }
  const hours = num(data.hoursOnSite);
  const missingRates = lines.filter(l => l.rate == null).map(l => l.rateKey);
  const complete = lines.length > 0 && !missingRates.length;
  const totalEx = complete ? roundMoney(lines.reduce((t, l) => t + l.amount, 0)) : null;
  const tax = gstFromEx(totalEx);
  return {
    ok: true, reason: "", packId: pack.id, lines, missingRates,
    totalEx, subtotalEx: totalEx, gst: tax.gst, totalInc: tax.totalInc,
    complete, adjustmentEx: 0,
    allocatedHours: hours == null ? 0 : roundQty(hours),
  };
}

function fail(pack, reason) {
  return {
    ok: false, reason, packId: pack.id, lines: [], missingRates: [],
    totalEx: null, subtotalEx: null, gst: null, totalInc: null, complete: false, adjustmentEx: 0, allocatedHours: 0,
  };
}

export function placeholderRates(pack) {
  const out = {};
  for (const line of pack.lines) {
    if (line.styles) {
      for (const style of line.styles) for (const height of style.heights) out[line.id + ":" + style.id + "@" + height.id] = height.defaultRate;
    } else if (line.options) {
      for (const opt of line.options) out[line.id + ":" + opt.id] = opt.defaultRate;
    } else out[line.id] = line.defaultRate;
  }
  return out;
}

export function freezePack(pack) {
  const walk = v => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.values(v).forEach(walk);
      Object.freeze(v);
    }
    return v;
  };
  return walk(pack);
}
