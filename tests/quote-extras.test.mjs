// Quote extra items, guided price overrides, GST totals, crew amounts and Places helpers. Pure functions, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calcQuote, newExtraItem, sanitizeExtraItems, sanitizeExtraItem, sanitizeOverrides, sanitizeSavedPresets,
  moveExtraItem, removeExtraItem, workAmounts, customerQuoteHtml, EXTRA_PRESETS, unitsForKind, GST_RATE, MAX_EXTRA_ITEMS
} from "../app/features/quotes.js";
import { sanitizePlace, placeFromGoogle, placesEnabled, SEQ_BOUNDS } from "../app/features/places.js";

const rates = {
  travelPerKm: 2, materialPerUnit: 30, tipPerLoad: 150,
  machineRates: { truck: { rate: 100, unit: "hour" }, skid: { rate: 80, unit: "hour" }, excavator: { rate: 120, unit: "hour" } },
  labourerRate: 45, labourerUnit: "hour"
};
const base = { hoursOnSite: 2, machines: ["truck"], travelKm: 0, materialQty: 0, tipLoads: 0 };

test("existing quotes without extra items or overrides calculate exactly as before", () => {
  const q = calcQuote(base, rates);
  assert.equal(q.totalEx, 200);
  assert.deepEqual(q.extraItems, []);
  assert.deepEqual(q.priceOverrides, {});
  assert.equal(q.adjustmentEx, 0);
  assert.equal(q.lines.some(l => l.extra), false);
  assert.equal(calcQuote({ ...base, extraItems: null, priceOverrides: "junk" }, rates).totalEx, 200);
});

test("extra items add qty × unit price, in order, after the guided lines", () => {
  const items = [
    { id: "a", kind: "rubbish", description: "Rubbish removal", qty: 6, unit: "m3", unitPrice: 55, material: "Green waste" },
    { id: "b", kind: "material", description: "Supply and deliver material", material: "Road base", qty: 10, unit: "t", unitPrice: 42.5 },
    { id: "c", kind: "misc", description: "Traffic control", qty: 1, unit: "each", unitPrice: 250, note: "half day" }
  ];
  const q = calcQuote({ ...base, extraItems: items }, rates);
  const extras = q.lines.filter(l => l.extra);
  assert.deepEqual(extras.map(l => l.extraId), ["a", "b", "c"]);
  assert.equal(extras[0].amount, 330);
  assert.equal(extras[1].amount, 425);
  assert.match(extras[1].label, /Road base/);
  assert.match(extras[0].label, /Green waste.*6 m³/);
  assert.equal(extras[2].note, "half day");
  assert.equal(q.extrasEx, 1005);
  assert.equal(q.totalEx, 1205);
  assert.equal(q.gst, 120.5);
  assert.equal(q.totalInc, 1325.5);
  assert.equal(q.gstRate, GST_RATE);
});

test("an extra item with a quantity and no price makes the total incomplete; zero quantity does not", () => {
  const q = calcQuote({ ...base, extraItems: [{ id: "a", kind: "tip", description: "Tip fees", qty: 2, unit: "t", unitPrice: null }] }, rates);
  assert.equal(q.complete, false);
  assert.equal(q.totalEx, null);
  assert.equal(q.gst, null);
  assert.deepEqual(q.missingRates, ["extra:a"]);
  const z = calcQuote({ ...base, extraItems: [{ id: "a", kind: "tip", qty: 0, unitPrice: null }] }, rates);
  assert.equal(z.complete, true);
  assert.equal(z.totalEx, 200);
});

test("admin price override replaces a guided line, keeps the original visible and shows the adjustment", () => {
  const q = calcQuote({ ...base, priceOverrides: { "machine:truck": 150 } }, rates);
  const truck = q.lines.find(l => l.key === "machine:truck");
  assert.equal(truck.overridden, true);
  assert.equal(truck.originalAmount, 200);
  assert.equal(truck.amount, 150);
  assert.equal(q.adjustmentEx, -50);
  assert.equal(q.totalEx, 150);
  assert.equal(q.totalInc, 165);
});

test("an override can price a guided line whose rate is missing", () => {
  const q = calcQuote({ ...base, travelKm: 30, priceOverrides: { travel: 90 } }, { ...rates, travelPerKm: null });
  assert.equal(q.complete, true);
  assert.equal(q.totalEx, 290);
});

test("overrides only accept guided line keys and non-negative numbers", () => {
  assert.deepEqual(sanitizeOverrides({ travel: "12.345", "machine:skid": 5, "extra:x": 9, bogus: 1, rubbish: -3, labourer: "" }),
    { travel: 12.35, "machine:skid": 5, rubbish: 0 }, "negative clamps to 0, blank is dropped");
  assert.deepEqual(sanitizeOverrides(null), {});
  assert.deepEqual(sanitizeOverrides([1, 2]), {});
});

test("built-in presets exist, take the company rate when set, and leave the price blank otherwise", () => {
  const ids = EXTRA_PRESETS.map(p => p.id);
  for (const id of ["rubbish", "concrete", "material", "tip", "travel", "misc"]) assert.ok(ids.includes(id), id);
  const rub = newExtraItem("rubbish", rates);
  assert.equal(rub.unitPrice, 150);
  assert.equal(rub.unit, "load");
  assert.equal(rub.material, "");
  assert.equal(newExtraItem("rubbish", {}).unitPrice, null);
  assert.equal(newExtraItem("rubbish", {}).unit, "m3");
  assert.equal(newExtraItem("material", rates).unitPrice, 30);
  assert.equal(newExtraItem("travel", rates).unit, "km");
  const con = newExtraItem("concrete", rates);
  assert.equal(con.kind, "concrete");
  assert.equal(con.unitPrice, null, "no concrete rate is invented");
  assert.equal(con.unit, "m3");
  assert.equal(newExtraItem("misc", rates).unitPrice, null);
  assert.equal(newExtraItem("nope", rates).kind, "custom");
});

test("unit pickers per kind: rubbish adds bags and skips; concrete and material are m³ / t / loads", () => {
  assert.deepEqual(unitsForKind("rubbish"), ["m3", "t", "load", "bag", "skip"]);
  assert.deepEqual(unitsForKind("concrete"), ["m3", "t", "load"]);
  assert.deepEqual(unitsForKind("material"), ["m3", "t", "load"]);
  assert.ok(unitsForKind("misc").includes("each"));
  assert.equal(sanitizeExtraItem({ kind: "concrete", unit: "bag" }).unit, "m3");
  assert.equal(sanitizeExtraItem({ kind: "rubbish", unit: "skip" }).unit, "skip");
});

test("sanitizing drops unknown fields, caps sizes and keeps ids unique", () => {
  const dirty = sanitizeExtraItems([
    { id: "a", kind: "misc", description: "x".repeat(500), qty: "-4", unitPrice: "-1", evil: "<script>", unit: "parsec" },
    { id: "a", kind: "material", material: "Topsoil", qty: "2.5", unitPrice: "40" }
  ]);
  assert.equal(dirty[0].description.length, 200);
  assert.equal(dirty[0].qty, 0);
  assert.equal(dirty[0].unitPrice, 0);
  assert.equal(dirty[0].unit, "each");
  assert.equal("evil" in dirty[0], false);
  assert.notEqual(dirty[0].id, dirty[1].id);
  assert.equal(dirty[1].material, "Topsoil");
  assert.equal(sanitizeExtraItems(Array.from({ length: 60 }, () => ({}))).length, MAX_EXTRA_ITEMS);
  assert.deepEqual(sanitizeExtraItems("nope"), []);
});

test("reorder and remove", () => {
  const l = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(moveExtraItem(l, 0, 1).map(x => x.id), [2, 1, 3]);
  assert.deepEqual(moveExtraItem(l, 2, -1).map(x => x.id), [1, 3, 2]);
  assert.deepEqual(moveExtraItem(l, 0, -1).map(x => x.id), [1, 2, 3]);
  assert.deepEqual(removeExtraItem(l, 1).map(x => x.id), [1, 3]);
  assert.equal(l.length, 3, "original not mutated");
});

test("saved company presets are cleaned and capped", () => {
  const p = sanitizeSavedPresets([{ label: "Skip bin 6m", unit: "skip", kind: "rubbish", unitPrice: "380" }, { label: "" }, null]);
  assert.equal(p.length, 1);
  assert.equal(p[0].unitPrice, 380);
  assert.equal(p[0].unit, "skip");
  assert.equal(sanitizeSavedPresets(Array.from({ length: 30 }, (_, i) => ({ label: "p" + i }))).length, 20);
  const item = newExtraItem(p[0], rates);
  assert.equal(item.unitPrice, 380);
  assert.equal(item.qty, 1);
});

test("crew amounts list rubbish, concrete and material amounts with types and notes — never prices", () => {
  const amounts = workAmounts({
    materialQty: 0, tipLoads: 2, ratesSnapshot: { tipUnitLabel: "load" },
    extraItems: [
      { id: "a", kind: "rubbish", description: "Rubbish removal", material: "Green waste", qty: 6, unit: "m3", unitPrice: 55 },
      { id: "b", kind: "concrete", description: "Concrete removal", qty: 3, unit: "t", unitPrice: 999, note: "reinforced slab, break-up needed" },
      { id: "c", kind: "material", description: "Supply and deliver material", material: "Road base", qty: 10, unit: "t", unitPrice: 42 },
      { id: "d", kind: "misc", description: "Nothing", qty: 0, unitPrice: 5 }
    ]
  });
  assert.deepEqual(amounts, [
    "Rubbish removed: 2 load",
    "Rubbish removal — Green waste: 6 m³",
    "Concrete removal: 3 t (reinforced slab, break-up needed)",
    "Supply and deliver material — Road base: 10 t"
  ]);
  assert.equal(amounts.some(a => /\$|999|55|42/.test(a)), false);
});

test("customer quote page lists extras, adjusted prices, subtotal, GST and total, and escapes text", () => {
  const items = [{ id: "a", kind: "concrete", description: "Concrete removal <b>", qty: 2, unit: "m3", unitPrice: 95, note: "footpath" }];
  const calc = calcQuote({ ...base, extraItems: items, priceOverrides: { "machine:truck": 180 } }, rates);
  const html = customerQuoteHtml({ client: "Orbit Homes", address: "1 Test St, Chuwar QLD 4306", dateIso: "2026-11-11T00:00:00Z" }, calc, { legalName: "Test Co Pty Ltd", abn: "00 000 000 000" });
  assert.match(html, /Concrete removal &lt;b&gt; \(2 m³\)/);
  assert.match(html, /footpath/);
  assert.match(html, /\$180\.00/);
  assert.doesNotMatch(html, /\$200\.00/, "customer sees the adjusted price, not the internal one");
  assert.match(html, /Subtotal ex GST<\/td><td class="r">\$370\.00/);
  assert.match(html, /GST \(10%\)<\/td><td class="r">\$37\.00/);
  assert.match(html, /Total inc GST<\/td><td class="r">\$407\.00/);
  assert.match(html, /11\/11\/2026/);
  assert.doesNotMatch(html, /<b>"?\)/);
});

test("Places: off without a key, picked places are cleaned, SE QLD bias box is sane", () => {
  assert.equal(placesEnabled({ placesApiKey: "" }), false);
  assert.equal(placesEnabled({}), false);
  assert.equal(placesEnabled({ placesApiKey: "short" }), false);
  assert.equal(placesEnabled({ placesApiKey: "A".repeat(39) }), true);
  assert.deepEqual(sanitizePlace({ formattedAddress: " 208-220 Holdsworth Rd, Chuwar QLD 4306, Australia ", lat: -27.5612345678, lng: 152.7812345678, placeId: "ChIJ_abc-123" }),
    { formattedAddress: "208-220 Holdsworth Rd, Chuwar QLD 4306, Australia", lat: -27.561235, lng: 152.781235, placeId: "ChIJ_abc-123", source: "google-places" });
  assert.equal(sanitizePlace({ formattedAddress: "x", lat: "nope", lng: 1 }), null);
  assert.equal(sanitizePlace({ lat: 1, lng: 1 }), null);
  assert.equal(sanitizePlace(null), null);
  const g = placeFromGoogle({ formattedAddress: "1 A St, Ipswich QLD 4305, Australia", id: "pid", location: { lat: () => -27.6, lng: () => 152.76 } });
  assert.equal(g.lat, -27.6); assert.equal(g.placeId, "pid");
  assert.ok(SEQ_BOUNDS.south < -27.47 && SEQ_BOUNDS.north > -27.47 && SEQ_BOUNDS.west < 153.02 && SEQ_BOUNDS.east > 153.02, "Brisbane inside the bias box");
  assert.ok(SEQ_BOUNDS.west < 152.78, "Chuwar depot inside the bias box");
});

test("no Maps key is committed, and the new files are in the offline cache", () => {
  const cfg = readFileSync(new URL("../app/maps-config.js", import.meta.url), "utf8");
  assert.match(cfg, /placesApiKey: ""/);
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /features\/places\.js/);
  assert.match(sw, /maps-config\.js/);
});

test("accepted job description carries amounts and no dollar figures", () => {
  const src = readFileSync(new URL("../app/features/quotes.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function createJobFromQuote"), src.indexOf("export function adminViewRouter"));
  const descBlock = fn.slice(fn.indexOf("const desc ="), fn.indexOf("const ref ="));
  assert.doesNotMatch(descBlock, /\$\$\{|toFixed/);
  assert.match(fn, /workAmounts: amounts/);
  assert.match(fn, /extraItems: sanitizeExtraItems\(q\.extraItems\)/);
});

test("round 3: GST is whole cents with half a cent rounding up", () => {
  for (const [ex, gst, inc] of [[10.35, 1.04, 11.39], [0.35, 0.04, 0.39], [1.45, 0.15, 1.6], [100, 10, 110], [0.04, 0, 0.04]]) {
    const c = calcQuote({ extraItems: [{ id: "a", kind: "misc", description: "x", qty: 1, unit: "each", unitPrice: ex }] }, {});
    assert.equal(c.totalEx, ex);
    assert.equal(c.gst, gst, `gst for ${ex}`);
    assert.equal(c.totalInc, inc, `inc for ${ex}`);
  }
});

test("round 3: crew amounts never carry a typed price", async () => {
  const { noDollars } = await import("../app/features/quotes.js");
  const out = workAmounts({ extraItems: [{ id: "a", kind: "rubbish", description: "Rubbish $450 + GST", qty: 6, unit: "m3", unitPrice: 75, note: "quoted A$1,200.50 inc GST" }] });
  assert.equal(out.length, 1);
  assert.ok(!out[0].includes("$"), out[0]);
  assert.ok(!/450|1,200/.test(out[0]), out[0]);
  assert.equal(noDollars("5 loads, no price"), "5 loads, no price");
});

test("round 3: the job copy of a quote carries no prices", () => {
  const src = readFileSync(new URL("../app/features/quotes.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("async function createJobFromQuote"), src.indexOf("export function adminViewRouter"));
  const quoteObj = block.slice(block.indexOf("quote: {"), block.indexOf("workAmounts: amounts"));
  for (const k of ["lines", "totalEx", "gst", "totalInc", "priceOverrides"]) assert.ok(!new RegExp(`\\b${k}:`).test(quoteObj), k);
  assert.match(quoteObj, /unitPrice, \.\.\.rest/);
});
