// Quote revision history (Phase 3). A changed save stores a numbered snapshot.
// Compare any two. This is not the "this quote only / save as company default" choice:
// that choice still writes a company rate. A revision only records this quote.
// Prices stay on the revision, which crew cannot read. Nothing here changes quote maths.

const MONEY = ["totalEx", "gst", "totalInc"];

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function lineOf(line) {
  const row = line && typeof line === "object" ? line : {};
  return {
    key: String(row.key || ""),
    label: String(row.label || row.key || "Line"),
    qty: num(row.qty) || 0,
    unit: String(row.unit || ""),
    rate: num(row.rate),
    amount: num(row.amount),
    note: String(row.note || "")
  };
}

function overridesOf(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [key, value] of Object.entries(map)) {
    const n = num(value);
    if (n != null) out[String(key)] = Math.round(n * 100) / 100;
  }
  return out;
}

/** Commercial snapshot: line items, quantities, prices, totals. Not the company rate card. */
export function commercialSnapshot(quote) {
  const src = quote && typeof quote === "object" ? quote : {};
  const lines = Array.isArray(src.lines) ? src.lines.map(lineOf).filter(line => line.key) : [];
  return {
    lines,
    priceOverrides: overridesOf(src.priceOverrides),
    totalEx: num(src.totalEx),
    gst: num(src.gst),
    totalInc: num(src.totalInc)
  };
}

export function sameCommercial(a, b) {
  return JSON.stringify(commercialSnapshot(a)) === JSON.stringify(commercialSnapshot(b));
}

function fieldChange(name, from, to) {
  return from === to ? null : { name, from, to };
}

export function diffRevisions(before, after) {
  const prev = commercialSnapshot(before);
  const next = commercialSnapshot(after);
  const prevLines = new Map(prev.lines.map(line => [line.key, line]));
  const nextLines = new Map(next.lines.map(line => [line.key, line]));
  const lines = [];
  for (const line of next.lines) {
    const old = prevLines.get(line.key);
    if (!old) {
      lines.push({ change: "added", key: line.key, label: line.label, qty: line.qty, rate: line.rate, amount: line.amount });
      continue;
    }
    const fields = ["label", "qty", "unit", "rate", "amount", "note"].map(name => fieldChange(name, old[name], line[name])).filter(Boolean);
    if (fields.length) lines.push({ change: "changed", key: line.key, label: line.label, fields });
  }
  for (const line of prev.lines) {
    if (!nextLines.has(line.key)) lines.push({ change: "removed", key: line.key, label: line.label, qty: line.qty, rate: line.rate, amount: line.amount });
  }
  const totals = MONEY.map(name => fieldChange(name, prev[name], next[name])).filter(Boolean);
  const overrides = [];
  const keys = new Set([...Object.keys(prev.priceOverrides), ...Object.keys(next.priceOverrides)]);
  for (const key of keys) {
    const from = Object.prototype.hasOwnProperty.call(prev.priceOverrides, key) ? prev.priceOverrides[key] : null;
    const to = Object.prototype.hasOwnProperty.call(next.priceOverrides, key) ? next.priceOverrides[key] : null;
    if (from !== to) overrides.push({ key, from, to });
  }
  return { lines, totals, overrides };
}

export function revisionNeeded(previousQuote, nextQuote) {
  const count = Number(previousQuote && previousQuote.revisionCount) || 0;
  if (count < 1) return true;
  return !sameCommercial(previousQuote, nextQuote);
}

function moneyText(value) {
  if (value == null) return "—";
  return "$" + Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function plain(value) {
  if (value == null || value === "") return "—";
  return String(value);
}

export function changeLines(diff, { showMoney = true } = {}) {
  const out = [];
  const price = value => (showMoney ? moneyText(value) : "hidden");
  for (const row of diff.lines || []) {
    if (row.change === "added") {
      out.push(showMoney ? `Added ${row.label} (${plain(row.qty)} × ${price(row.rate)})` : `Added ${row.label} (qty ${plain(row.qty)})`);
    } else if (row.change === "removed") {
      out.push(`Removed ${row.label}`);
    } else {
      const bits = (row.fields || []).filter(field => showMoney || (field.name !== "rate" && field.name !== "amount")).map(field => {
        const format = field.name === "rate" || field.name === "amount" ? price : plain;
        return `${field.name} ${format(field.from)} → ${format(field.to)}`;
      });
      if (bits.length) out.push(`${row.label}: ${bits.join(", ")}`);
      else if (!showMoney && (row.fields || []).some(field => field.name === "rate" || field.name === "amount")) out.push(`${row.label}: price changed`);
    }
  }
  if (showMoney) {
    for (const row of diff.totals || []) out.push(`${row.name} ${price(row.from)} → ${price(row.to)}`);
    for (const row of diff.overrides || []) out.push(`Price adjustment ${row.key} ${price(row.from)} → ${price(row.to)}`);
  } else if ((diff.totals || []).length || (diff.overrides || []).length) {
    out.push("Totals changed");
  }
  return out.map(line => line.slice(0, 180)).slice(0, 80);
}

export function revisionDocId(n) {
  const num = Math.max(1, Math.min(999, Number(n) || 1));
  return "r" + String(num).padStart(3, "0");
}

export function revisionBody({ revision, quoteId, companyId, uid, name, atIso, snapshot, changes }) {
  const snap = commercialSnapshot(snapshot);
  return {
    revision: Number(revision),
    quoteId: String(quoteId || ""),
    companyId: String(companyId || ""),
    createdBy: String(uid || ""),
    createdByName: String(name || "Staff").slice(0, 80),
    createdAtIso: String(atIso || "").slice(0, 40),
    lines: snap.lines,
    extraItems: [],
    priceOverrides: snap.priceOverrides,
    totalEx: snap.totalEx,
    gst: snap.gst,
    totalInc: snap.totalInc,
    changes: (changes || []).map(line => String(line).slice(0, 180)).slice(0, 80)
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function compareHtml(before, after, { showMoney = false } = {}) {
  const diff = diffRevisions(before, after);
  const lines = changeLines(diff, { showMoney });
  if (!lines.length) return `<p class="sub">No differences.</p>`;
  return `<ul class="rev-diff">${lines.map(line => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

export function revisionsPanelHtml(revisions, { showMoney = false, acceptedRevision = null, compareA = "", compareB = "" } = {}) {
  const list = (revisions || []).slice().sort((a, b) => (a.revision || 0) - (b.revision || 0));
  if (!list.length) return `<div class="rev-panel" id="revpanel"><h3>Revisions</h3><p class="sub">No saved revisions yet. A changed save stores the next one.</p></div>`;
  const option = (rev, selected) => `<option value="${esc(rev.revision)}"${String(selected) === String(rev.revision) ? " selected" : ""}>Rev ${esc(rev.revision)}</option>`;
  const a = compareA || list[0].revision;
  const b = compareB || list[list.length - 1].revision;
  const left = list.find(rev => String(rev.revision) === String(a)) || list[0];
  const right = list.find(rev => String(rev.revision) === String(b)) || list[list.length - 1];
  const rows = list.map(rev => {
    const when = String(rev.createdAtIso || "").replace("T", " ").slice(0, 16);
    const what = showMoney ? (rev.changes || []).join("; ") : ((rev.changes || []).length ? "Saved" : "");
    const accepted = acceptedRevision != null && Number(acceptedRevision) === Number(rev.revision) ? " · accepted" : "";
    return `<li><b>Rev ${esc(rev.revision)}</b>${accepted} · ${esc(rev.createdByName || "Staff")} · ${esc(when)}${what ? `<div class="sub">${esc(what)}</div>` : ""}</li>`;
  }).join("");
  return `<div class="rev-panel" id="revpanel"><h3>Revisions</h3>
    <p class="sub">Each changed save is kept. Accepted revisions are not edited. This is separate from saving a price as the company default.</p>
    <ol class="rev-list">${rows}</ol>
    <div class="rev-cmp">
      <label>Compare <select id="reva" aria-label="Earlier revision">${list.map(rev => option(rev, left.revision)).join("")}</select></label>
      <label>with <select id="revb" aria-label="Later revision">${list.map(rev => option(rev, right.revision)).join("")}</select></label>
    </div>
    <div id="revdiff">${compareHtml(left, right, { showMoney })}</div></div>`;
}
