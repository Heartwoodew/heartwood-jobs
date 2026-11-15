import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FENCING } from "../app/features/packs/fencing.js";
import { packRateInputs } from "../app/features/packs/money.js";
import {
  buildQuoteRatesSave, calcQuote, calcSections, jobsFromAcceptedQuote, quoteRatesPath, quoteRatesSettingsBlurb,
  quotesViewHtml, ratesEditorHtml, setQuoteTradeSetup,
} from "../app/features/quotes.js";

const esc = s => String(s ?? "");

function fencingInput(name) {
  return packRateInputs(FENCING).find(row => row.name === name || row.calcKey === name);
}

const colorbond = fencingInput("run:colorbond@1.8");
const labour = fencingInput("labour");

function fenceQuote(rates, quotePrices) {
  return calcSections({
    type: "fe-colorbond",
    packId: "fencing",
    measures: { run: { length: 10, wastePct: 0, style: "colorbond", height: "1.8" } },
    quotePrices: quotePrices || {},
  }, rates);
}

function runLine(calc) {
  const line = calc.lines.find(l => l.id === "run");
  assert.ok(line, "fence run line");
  return line;
}

test("an earthworks-only company sees plant, the truck presets and the labourer, and not fencing lines", () => {
  const html = ratesEditorHtml({
    machineRates: { truck: { rate: 100, unit: "hour" }, skid: { rate: null, unit: "hour" }, excavator: { rate: null, unit: "day" } },
    labourerRate: 45,
  }, { enabled: ["earthworks"], companyId: "heartwood" }, esc);
  assert.match(html, /data-rates-trade="earthworks"/);
  assert.match(html, /<h3>Earthworks<\/h3>/);
  assert.match(html, /Plant \(operator included\)/);
  assert.match(html, /Truck/);
  assert.match(html, /Skid steer \(Bobcat\)/);
  assert.match(html, /Excavator \(JCB\)/);
  assert.match(html, /name="mr_truck"/);
  assert.match(html, /Presets: Truck \+ skid/);
  assert.match(html, /Labourer/);
  assert.match(html, /name="materialPerUnit"/);
  assert.match(html, /name="tipPerLoad"/);
  assert.match(html, /name="travelPerKm"/);
  assert.match(html, /name="yardAddress"/);
  assert.match(html, /Saved extra items/);
  assert.equal(html.includes('data-rates-trade="fencing"'), false);
  assert.equal(html.includes("Colorbond"), false);
});

test("a fencing-only company sees fencing lines and units, and no plant, truck or materials fields", () => {
  const html = ratesEditorHtml({}, { enabled: ["fencing"], companyId: "bravo" }, esc);
  assert.match(html, /<h3>Fencing<\/h3>/);
  assert.match(html, /Fence — Colorbond, 1\.8 m/);
  assert.match(html, /\$ \/ m ex GST/);
  assert.match(html, new RegExp(`name="${colorbond.name}"`));
  assert.match(html, /placeholder="155"/);
  assert.match(html, /data-rate-key="run:colorbond@1\.8"/);
  assert.match(html, /Crew labour/);
  assert.match(html, /\$ \/ h ex GST/);
  assert.match(html, new RegExp(`name="${labour.name}"`));
  assert.match(html, /placeholder="72"/);
  assert.match(html, /name="travelPerKm"/);
  assert.match(html, /name="yardAddress"/);
  assert.match(html, /Depot Maps link/);
  assert.match(html, /Saved extra items/);
  assert.equal(html.includes('data-rates-trade="earthworks"'), false);
  assert.equal(html.includes("Plant (operator included)"), false);
  assert.equal(html.includes("Skid steer"), false);
  assert.equal(html.includes("Excavator"), false);
  assert.equal(html.includes('name="mr_truck"'), false);
  assert.equal(html.includes("Truck + skid"), false);
  assert.equal(html.includes('name="materialPerUnit"'), false);
  assert.equal(html.includes('name="tipPerLoad"'), false);
  assert.equal(html.includes("truck"), false);
  assert.equal(html.includes("skid"), false);
  assert.equal(html.includes("excavator"), false);
});

test("a company with earthworks and fencing sees both sections, in the company's trade order", () => {
  const earthFirst = ratesEditorHtml({}, { enabled: ["earthworks", "fencing"] }, esc);
  assert.ok(earthFirst.indexOf('data-rates-trade="earthworks"') < earthFirst.indexOf('data-rates-trade="fencing"'));
  assert.ok(earthFirst.indexOf('data-rates-trade="fencing"') < earthFirst.indexOf('data-rates-shared="travel"'));
  assert.match(earthFirst, /Plant \(operator included\)/);
  assert.match(earthFirst, /Colorbond, 1\.8 m/);
  assert.match(earthFirst, /name="materialPerUnit"/);
  const fenceFirst = ratesEditorHtml({}, { enabled: ["fencing", "concreting", "earthworks"] }, esc);
  const fenceAt = fenceFirst.indexOf('data-rates-trade="fencing"');
  const concreteAt = fenceFirst.indexOf('data-rates-trade="concreting"');
  const earthAt = fenceFirst.indexOf('data-rates-trade="earthworks"');
  assert.ok(fenceAt < concreteAt && concreteAt < earthAt);
  assert.match(fenceFirst, /Finish — Broom/);
  assert.match(fenceFirst, /placeholder="12"/);
  assert.match(fenceFirst, /\$ \/ m² ex GST/);
});

test("a saved fencing rate is the value in the editor and the price on a fencing quote", () => {
  const html = ratesEditorHtml({
    tradeRates: { fencing: { run: { "colorbond@1.8": 200 }, labour: 90 } },
  }, { enabled: ["fencing"] }, esc);
  assert.match(html, new RegExp(`name="${colorbond.name}"[^>]*value="200"`));
  assert.match(html, new RegExp(`name="${labour.name}"[^>]*value="90"`));
  assert.match(html, /placeholder="155"/);

  const priced = fenceQuote({ tradeRates: { fencing: { run: { "colorbond@1.8": 200 } } } });
  assert.equal(runLine(priced).rate, 200);
  assert.equal(runLine(priced).rateSource, "company");
  assert.equal(runLine(priced).amount, 2000);
  assert.equal(priced.totalEx, 2000);

  const fallback = fenceQuote({});
  assert.equal(runLine(fallback).rate, 155);
  assert.equal(runLine(fallback).rateSource, "default");
  assert.equal(runLine(fallback).amount, 1550);

  const quoteWins = fenceQuote(
    { tradeRates: { fencing: { run: { "colorbond@1.8": 200 } } } },
    { "run:colorbond@1.8": 10 },
  );
  assert.equal(runLine(quoteWins).rate, 10);
  assert.equal(runLine(quoteWins).rateSource, "quote");

  const legacy = fenceQuote({ packRates: { fencing: { "run:colorbond@1.8": 180 } } });
  assert.equal(runLine(legacy).rate, 180);
  assert.equal(runLine(legacy).rateSource, "company");
  const editorWins = fenceQuote({
    packRates: { fencing: { "run:colorbond@1.8": 180 } },
    tradeRates: { fencing: { run: { "colorbond@1.8": 200 } } },
  });
  assert.equal(runLine(editorWins).rate, 200);
  const cleared = fenceQuote({
    packRates: { fencing: { "run:colorbond@1.8": 180 } },
    tradeRates: { fencing: {} },
  });
  assert.equal(runLine(cleared).rate, 155);
  assert.equal(runLine(cleared).rateSource, "default");
});

test("Heartwood keeps the meta/quoteRates path, plant fields and plant maths", () => {
  assert.deepEqual(quoteRatesPath("heartwood"), ["meta", "quoteRates"]);
  assert.deepEqual(quoteRatesPath("callup-test-h2vx"), ["companyMeta", "callup-test-h2vx_quoteRates"]);
  const built = buildQuoteRatesSave({
    mr_truck: "100", mu_truck: "hour",
    mr_skid: "80", mu_skid: "hour",
    mr_excavator: "", mu_excavator: "day",
    labourerRate: "45", labourerUnit: "hour",
    travelPerKm: "2",
    materialPerUnit: "3", tipPerLoad: "4",
    materialUnitLabel: "unit", tipUnitLabel: "load",
    yardAddress: "208-220 Holdsworth Rd, Chuwar QLD 4306",
    yardMapsUrl: "https://maps.app.goo.gl/w4AX7X6VtPtqH75S7?g_st=ic",
  }, {}, { enabled: ["earthworks"], companyId: "heartwood" });
  assert.equal(built.fields.machineRates.truck.rate, 100);
  assert.equal(built.fields.machineRates.truck.unit, "hour");
  assert.equal(built.fields.machineRates.skid.rate, 80);
  assert.equal(built.fields.machineRates.excavator.rate, null);
  assert.equal(built.fields.machineRates.excavator.unit, "day");
  assert.equal(built.fields.labourerRate, 45);
  assert.equal(built.fields.hourlyOnSite, null);
  assert.equal(built.fields.materialPerUnit, 3);
  assert.equal(built.fields.tipPerLoad, 4);
  assert.deepEqual(built.tradeRates, {});
  const rates = {
    travelPerKm: 2, materialPerUnit: 3, tipPerLoad: 4,
    machineRates: {
      truck: { rate: 100, unit: "hour" },
      skid: { rate: 80, unit: "hour" },
      excavator: { rate: 120, unit: "hour" },
    },
    labourerRate: 45, labourerUnit: "hour",
  };
  const q = calcQuote({ hoursOnSite: 2, machines: ["truck", "skid"], includeLabourer: false, travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  assert.equal(q.totalEx, 360);
  const viaSections = calcSections({ type: "spoil", hoursOnSite: 2, machines: ["truck", "skid"], travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  assert.equal(viaSections.totalEx, 360);
  assert.match(quoteRatesSettingsBlurb(["earthworks"]), /plant, labour, travel and tip rates/);
});

test("turning a trade off hides its rates and does not put them in the save", () => {
  const previous = {
    machineRates: { truck: { rate: 100, unit: "hour" }, skid: { rate: 80, unit: "hour" }, excavator: { rate: 90, unit: "hour" } },
    labourerRate: 40,
    materialPerUnit: 11,
    tipPerLoad: 50,
    tradeRates: { landscaping: { turf: 22 }, fencing: { labour: 90, posts: 48 } },
    extraPresets: [{ id: "p1", kind: "custom", label: "Skip", description: "Skip", unit: "each", unitPrice: 10 }],
  };
  const built = buildQuoteRatesSave({
    travelPerKm: "4",
    yardAddress: "9 Yard St",
    yardMapsUrl: "",
    [colorbond.name]: "210",
  }, previous, { enabled: ["fencing"] });
  assert.equal(built.fields.machineRates, undefined);
  assert.equal(built.fields.labourerRate, undefined);
  assert.equal(built.fields.materialPerUnit, undefined);
  assert.equal(built.fields.tipPerLoad, undefined);
  assert.equal(built.fields.travelPerKm, 4);
  assert.equal(built.fields.yardAddress, "9 Yard St");
  assert.equal(built.fields.extraPresets[0].label, "Skip");
  assert.equal(built.tradeRates.landscaping, undefined);
  assert.equal(built.tradeRates.fencing.labour, undefined);
  assert.equal(built.tradeRates.fencing.posts, undefined);
  assert.equal(built.tradeRates.fencing.run["colorbond@1.8"], 210);
  const kept = { ...previous.tradeRates, ...built.tradeRates };
  assert.equal(kept.landscaping.turf, 22);
  assert.equal(kept.fencing.labour, undefined);
  assert.equal(kept.fencing.run["colorbond@1.8"], 210);
  assert.equal(quoteRatesSettingsBlurb(["fencing"]).includes("truck"), false);
  assert.equal(quoteRatesSettingsBlurb(["fencing"]).includes("skid"), false);
  assert.equal(quoteRatesSettingsBlurb(["fencing"]).includes("excavator"), false);
  assert.equal(quoteRatesSettingsBlurb(["fencing"]).includes("plant"), false);
});

test("crew do not get the rate editor, and a fencing job plan has no prices", () => {
  setQuoteTradeSetup({ enabled: ["fencing"], trade: "fencing", titles: [] });
  const hidden = quotesViewHtml({ quoteRates: {}, quotes: [] }, esc, v => "$" + v, { canEditQuoteRates: () => false });
  assert.equal(hidden.includes('id="editrates"'), false);
  assert.equal(hidden.includes("Set plant"), false);
  assert.equal(hidden.includes("Skid steer"), false);
  assert.equal(hidden.includes("Excavator"), false);
  const shown = quotesViewHtml({ quoteRates: {}, quotes: [] }, esc, v => "$" + v, { canEditQuoteRates: () => true });
  assert.match(shown, /id="editrates"/);
  assert.equal(shown.includes("Set plant"), false);
  const calc = fenceQuote({ tradeRates: { fencing: { run: { "colorbond@1.8": 177 } } } });
  const [plan] = jobsFromAcceptedQuote({ description: "Fence the side", client: "A" }, calc, "one");
  const crew = JSON.stringify({ description: plan.description, workAmounts: plan.workAmounts, quote: plan.quote });
  assert.equal(crew.includes("177"), false);
  assert.equal(crew.includes("$"), false);
  assert.match(crew, /10 m/);
  const src = readFileSync(new URL("../app/features/quotes.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function openRatesEditor"), src.indexOf("function savedPresetsEditorHtml"));
  assert.match(fn, /if \(!canEditRates\(\)\) return api\.toast\("Only an admin or a manager can change quote rates"\)/);
  setQuoteTradeSetup(null);
});

test("quote-rates rules do not field-lock the document, so a tradeRates map is already allowed", () => {
  const rules = readFileSync(new URL("../cloud/firestore.production.rules", import.meta.url), "utf8");
  const meta = rules.slice(rules.indexOf("match /meta/{docId}"), rules.indexOf("// Per-company settings"));
  assert.match(meta, /docId == "quoteRates"/);
  assert.equal(meta.includes("hasOnly("), false);
  const write = rules.slice(rules.indexOf("function cmWriteOk"), rules.indexOf("match /companyMeta/"));
  assert.match(write, /docId == c \+ "_quoteRates" && role in \["admin", "manager"\]/);
  assert.equal(write.includes("hasOnly("), false);
});
