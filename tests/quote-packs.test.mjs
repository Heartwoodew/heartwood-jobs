import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcLandscaping, LANDSCAPING } from "../app/features/packs/landscaping.js";
import { calcConcreting, CONCRETING } from "../app/features/packs/concreting.js";
import { calcFencing, FENCING } from "../app/features/packs/fencing.js";
import { calcCarpentry, CARPENTRY } from "../app/features/packs/carpentry.js";
import { calcTiling, TILING } from "../app/features/packs/tiling.js";
import { calcPlumbing, PLUMBING } from "../app/features/packs/plumbing.js";
import { calcElectrical, ELECTRICAL } from "../app/features/packs/electrical.js";
import { gstFromEx, measureQty, placeholderRates } from "../app/features/packs/money.js";
import { measureReviewHtml, measureSetupHtml } from "../app/features/packs/form.js";
import { measuredJobFields } from "../app/features/quotes.js";
import { quotePack } from "../app/features/trades.js";

const GST = [[10.35, 1.04, 11.39], [10.34, 1.03, 11.37], [0.05, 0.01, 0.06], [1.25, 0.13, 1.38]];

function line(calc, id) {
  const row = calc.lines.find(l => l.id === id);
  assert.ok(row, id);
  return row;
}

test("measure helper rounds area, volume, linear metres and waste, and caps waste at 100", () => {
  assert.deepEqual(measureQty({ measure: "area", length: 5, width: 2 }), { ok: true, qty: 10, base: 10, wastePct: 0, unit: "m2" });
  assert.equal(measureQty({ measure: "volume", length: 2, width: 3, depth: 0.5, wastePct: 10 }).qty, 3.3);
  assert.equal(measureQty({ measure: "linear", length: 12, wastePct: 5 }).qty, 12.6);
  assert.equal(measureQty({ measure: "volume", length: 2, width: 3, depth: 0.333 }).qty, 1.998);
  assert.equal(measureQty({ measure: "area", length: 1, width: 1, wastePct: 150 }).wastePct, 100);
  assert.equal(measureQty({ measure: "volume", length: 1, width: 1 }).ok, false);
  assert.equal(measureQty({ measure: "mix" }).ok, false);
});

test("GST stays in whole cents for each pack calculator", () => {
  const cases = [
    [calcLandscaping, { packageId: "soft", measures: { turf: { length: 1, width: 1, wastePct: 0 } } }, "turf"],
    [calcConcreting, { measures: { slab: { length: 1, width: 1, depth: 1, wastePct: 0 }, mesh: { on: false }, finish: { on: false } } }, "concrete"],
    [calcFencing, { measures: { run: { length: 1, wastePct: 0, style: "colorbond", height: "1.8" } } }, "run:colorbond@1.8"],
    [calcCarpentry, { packageId: "frame", measures: { sheets: { length: 1, width: 1, wastePct: 0 } } }, "sheets"],
    [calcTiling, { packageId: "floor", measures: { floor: { length: 1, width: 1, wastePct: 0 } } }, "floor"],
    [calcPlumbing, { packageId: "rough", measures: { points: { qty: 1 } } }, "points"],
    [calcElectrical, { packageId: "rough", measures: { epoints: { qty: 1 } } }, "epoints"],
  ];
  for (const [fn, input, key] of cases) {
    for (const [ex, gst, inc] of GST) {
      const calc = fn({ ...input, quotePrices: { [key]: ex } });
      assert.equal(calc.ok, true, key);
      assert.equal(calc.totalEx, ex, key + " ex " + ex);
      assert.equal(calc.gst, gst, key + " gst " + ex);
      assert.equal(calc.totalInc, inc, key + " inc " + ex);
      assert.equal(calc.gst, gstFromEx(ex).gst);
    }
  }
});

test("landscaping prices soft area and volume, and hard linear, from placeholders", () => {
  assert.equal(placeholderRates(LANDSCAPING).turf, 18);
  assert.equal(placeholderRates(LANDSCAPING).mulch, 90);
  assert.equal(placeholderRates(LANDSCAPING).edging, 38);
  const soft = calcLandscaping({
    packageId: "soft",
    measures: {
      turf: { length: 10, width: 5, wastePct: 5 },
      mulch: { length: 4, width: 2, depth: 0.1, wastePct: 10 },
      paving: { length: 3, width: 3, wastePct: 0 },
    },
  });
  assert.equal(line(soft, "turf").qty, 52.5);
  assert.equal(line(soft, "turf").amount, 945);
  assert.equal(line(soft, "turf").rateSource, "default");
  assert.equal(line(soft, "turf").rateLabel, "Default to review");
  assert.equal(line(soft, "turf").lineType, "material");
  assert.equal(line(soft, "mulch").qty, 0.88);
  assert.equal(line(soft, "mulch").amount, 79.2);
  assert.equal(line(soft, "mulch").lineType, "material");
  assert.equal(soft.lines.some(l => l.id === "paving"), false);
  const hard = calcLandscaping({
    packageId: "hard",
    measures: {
      edging: { length: 12, wastePct: 5 },
      retaining: { length: 8, width: 0.6, wastePct: 0 },
      hire: { qty: 3 },
      greenwaste: { length: 2, width: 1, depth: 0.5, wastePct: 0 },
    },
  });
  assert.equal(line(hard, "edging").qty, 12.6);
  assert.equal(line(hard, "edging").amount, 478.8);
  assert.equal(line(hard, "retaining").qty, 4.8);
  assert.equal(line(hard, "retaining").lineType, "material");
  assert.equal(line(hard, "hire").qty, 3);
  assert.equal(line(hard, "hire").lineType, "hire");
  assert.equal(line(hard, "hire").amount, 435);
  assert.equal(line(hard, "greenwaste").qty, 1);
  assert.equal(line(hard, "greenwaste").lineType, "waste");
  assert.equal(hard.lines.some(l => l.id === "turf"), false);
  const both = calcLandscaping({ packageId: "both", measures: { turf: { length: 2, width: 2, wastePct: 0 }, paving: { length: 2, width: 2, wastePct: 0 } } });
  assert.equal(both.lines.filter(l => l.id === "turf" || l.id === "paving").length, 2);
});

test("landscaping allocated hours can be priced and do not change the area", () => {
  const plain = calcLandscaping({ packageId: "soft", hoursOnSite: 6, measures: { turf: { length: 2, width: 2, wastePct: 0 } } });
  assert.equal(plain.allocatedHours, 6);
  assert.equal(plain.lines.some(l => l.id === "labour"), false);
  assert.equal(line(plain, "turf").qty, 4);
  const priced = calcLandscaping({ packageId: "soft", hoursOnSite: 6, includeLabour: true, measures: { turf: { length: 2, width: 2, wastePct: 0 } } });
  assert.equal(line(priced, "labour").qty, 6);
  assert.equal(line(priced, "labour").amount, 408);
  assert.equal(line(priced, "labour").lineType, "labour");
  assert.equal(line(priced, "turf").qty, 4);
});

test("a company default replaces the placeholder, and this quote only wins over both", () => {
  const company = calcLandscaping({
    packageId: "soft",
    measures: { turf: { length: 2, width: 2, wastePct: 0 } },
  }, { turf: 20 });
  assert.equal(line(company, "turf").rate, 20);
  assert.equal(line(company, "turf").rateSource, "company");
  assert.equal(line(company, "turf").amount, 80);
  const quote = calcLandscaping({
    packageId: "soft",
    measures: { turf: { length: 2, width: 2, wastePct: 0 } },
    quotePrices: { turf: 15 },
  }, { turf: 20 });
  assert.equal(line(quote, "turf").rate, 15);
  assert.equal(line(quote, "turf").rateSource, "quote");
  assert.equal(line(quote, "turf").amount, 60);
});

test("concreting is length × width × depth plus waste, with no mix design", () => {
  assert.equal(placeholderRates(CONCRETING).concrete, 310);
  assert.equal(placeholderRates(CONCRETING)["finish:broom"], 12);
  assert.equal(placeholderRates(CONCRETING)["finish:exposed"], 45);
  assert.equal(placeholderRates(CONCRETING)["finish:honed"], 65);
  assert.equal(CONCRETING.lines.some(l => /mix|mpa|slump|cement|aggregate/i.test(l.id)), false);
  const base = { length: 5, width: 4, depth: 0.1, wastePct: 10 };
  const calc = calcConcreting({ measures: { slab: base, formwork: { length: 18, wastePct: 0 }, pump: { qty: 2 } } });
  assert.equal(line(calc, "concrete").qty, 2.2);
  assert.equal(line(calc, "concrete").unit, "m3");
  assert.equal(line(calc, "concrete").amount, 682);
  assert.equal(line(calc, "mesh").qty, 22);
  assert.equal(line(calc, "mesh").amount, 616);
  assert.equal(line(calc, "mesh").lineType, "material");
  assert.equal(line(calc, "finish").name, "Finish — Broom");
  assert.equal(line(calc, "finish").qty, 22);
  assert.equal(line(calc, "finish").amount, 264);
  assert.equal(line(calc, "formwork").qty, 18);
  assert.equal(line(calc, "formwork").amount, 990);
  assert.equal(line(calc, "pump").qty, 2);
  assert.equal(line(calc, "pump").lineType, "hire");
  assert.equal(line(calc, "pump").amount, 440);
  assert.equal(calc.totalEx, 682 + 616 + 264 + 990 + 440);
  assert.equal(calc.gst, gstFromEx(calc.totalEx).gst);
  const mixed = calcConcreting({ measures: { slab: { ...base, mpa: 40, cement: 320, slump: 80 } } });
  assert.equal(line(mixed, "concrete").qty, line(calc, "concrete").qty);
  assert.equal(line(mixed, "concrete").amount, line(calc, "concrete").amount);
  const honed = calcConcreting({ measures: { slab: base, finish: { on: true, option: "honed" }, mesh: { on: false } } });
  assert.equal(line(honed, "finish").rate, 65);
  assert.equal(honed.lines.some(l => l.id === "mesh"), false);
  assert.match(calcConcreting({ measures: { slab: { length: 5, width: 4 } } }).reason, /depth/);
});

test("fencing is linear metres plus height and style, with post, gate, footing and removal extras", () => {
  assert.equal(placeholderRates(FENCING)["run:colorbond@1.8"], 155);
  assert.equal(placeholderRates(FENCING)["run:timber@1.8"], 130);
  assert.equal(placeholderRates(FENCING)["run:pool@1.2"], 290);
  assert.equal(placeholderRates(FENCING)["run:chain@1.8"], 85);
  assert.equal(placeholderRates(FENCING).posts, 48);
  assert.equal(placeholderRates(FENCING).gates, 480);
  assert.equal(placeholderRates(FENCING).footings, 42);
  assert.equal(placeholderRates(FENCING).removal, 32);
  const calc = calcFencing({
    measures: {
      run: { length: 12, wastePct: 5, style: "colorbond", height: "1.8" },
      posts: { qty: 4 },
      gates: { qty: 1 },
      footings: { qty: 4 },
      removal: { length: 12, wastePct: 0 },
      compliance: { qty: 1 },
    },
  });
  assert.equal(line(calc, "run").qty, 12.6);
  assert.equal(line(calc, "run").name, "Fence — Colorbond, 1.8 m");
  assert.equal(line(calc, "run").amount, 1953);
  assert.equal(line(calc, "posts").amount, 192);
  assert.equal(line(calc, "gates").amount, 480);
  assert.equal(line(calc, "footings").amount, 168);
  assert.equal(line(calc, "footings").lineType, "material");
  assert.equal(line(calc, "removal").qty, 12);
  assert.equal(line(calc, "removal").lineType, "waste");
  assert.equal(line(calc, "removal").amount, 384);
  assert.equal(line(calc, "compliance").lineType, "compliance");
  assert.equal(line(calc, "compliance").amount, 250);
  const pool = calcFencing({ measures: { run: { length: 10, wastePct: 0, style: "pool", height: "1.2" } } });
  assert.equal(line(pool, "run").rate, 290);
  assert.equal(line(pool, "run").amount, 2900);
  const chain = calcFencing({ measures: { run: { length: 10, wastePct: 0, style: "chain", height: "2.1" } } });
  assert.equal(line(chain, "run").rate, 105);
  assert.match(calcFencing({ measures: { run: { length: 10, wastePct: 0, style: "pool", height: "1.8" } } }).reason, /height/);
});

test("the crew copy of a measured quote has quantities and allocated hours, and no dollars", () => {
  const calc = calcConcreting({
    hoursOnSite: 7.5,
    includeLabour: true,
    measures: { slab: { length: 5, width: 4, depth: 0.1, wastePct: 10 }, mesh: { on: false }, finish: { on: false } },
  });
  const job = measuredJobFields({
    packId: "concreting",
    packageId: "pour",
    description: "Driveway $1,250.00 ex GST",
    hoursOnSite: 7.5,
    allocatedHours: 7.5,
    lines: calc.lines,
  });
  assert.equal(job.allocatedHours, 7.5);
  assert.match(job.description, /Allocated hours: 7.5/);
  assert.doesNotMatch(job.description, /\$|1,250/);
  assert.ok(job.workAmounts.length > 0);
  assert.equal(JSON.stringify(job.quote).includes("$"), false);
  assert.equal(JSON.stringify(job.quote).includes("310"), false);
  assert.equal(job.quote.lines.some(l => "rate" in l || "amount" in l || "unitPrice" in l), false);
  const text = JSON.stringify(job);
  assert.equal(text.includes("totalEx") || text.includes("gst") || text.includes("unitPrice"), false);
  const timesheet = readFileSync(new URL("../app/features/timesheet.js", import.meta.url), "utf8");
  assert.doesNotMatch(timesheet, /allocatedHours/);
  const src = readFileSync(new URL("../app/features/quotes.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function createMeasuredJob"), src.indexOf("async function createJobFromQuote"));
  assert.doesNotMatch(fn, /timesheets/);
  assert.match(fn, /jobMoneyDoc/);
  assert.equal(quotePack("earthworks").wizard, "plant");
});

test("the measured wizard labels placeholder prices and asks this quote only or company default", () => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const setup = measureSetupHtml(CONCRETING, { packageId: "pour", measures: { mesh: { on: true }, finish: { on: true, option: "broom" } }, includeLabour: false }, esc);
  assert.match(setup, /defaults to review/i);
  assert.match(setup, /No mix design/);
  assert.doesNotMatch(setup, /mpa|slump|cement|mix design field/i);
  assert.match(setup, /Depth m/);
  assert.match(setup, /Waste %/);
  const fence = measureSetupHtml(FENCING, { packageId: "fence", measures: { run: { style: "timber", height: "1.8" } } }, esc);
  assert.match(fence, /Timber paling/);
  assert.match(fence, /Pool fence/);
  assert.match(fence, /Chain wire/);
  assert.match(fence, /Extra posts/);
  assert.match(fence, /Gates/);
  assert.match(fence, /Concrete footings/);
  assert.match(fence, /Old fence removal/);
  const calc = calcLandscaping({ packageId: "soft", measures: { turf: { length: 1, width: 1, wastePct: 0 } } });
  const review = measureReviewHtml(calc, esc, true, true);
  assert.match(review, /Default to review/);
  assert.match(review, /This quote only/);
  assert.match(review, /Save as company default/);
  assert.match(review, /\$ \/ m² ex GST/);
  const hidden = measureReviewHtml(calc, esc, false, false);
  assert.doesNotMatch(hidden, /\$ \/|data-packprice/);
});

test("carpentry take-offs apply waste, and wet-area and labour-only stay on their templates", () => {
  assert.equal(placeholderRates(CARPENTRY).sheets, 48);
  assert.equal(placeholderRates(CARPENTRY).lining, 78);
  assert.equal(placeholderRates(CARPENTRY).labourhours, 85);
  const frame = calcCarpentry({
    packageId: "frame",
    measures: {
      sheets: { length: 10, width: 2.4, wastePct: 10 },
      framing: { length: 12, wastePct: 8 },
      deck: { length: 6, width: 4, wastePct: 0 },
    },
  });
  assert.equal(line(frame, "sheets").qty, 26.4);
  assert.equal(line(frame, "sheets").amount, 1267.2);
  assert.equal(line(frame, "sheets").rateSource, "default");
  assert.equal(line(frame, "framing").qty, 12.96);
  assert.equal(line(frame, "framing").amount, 414.72);
  assert.equal(frame.lines.some(l => l.id === "deck" || l.id === "lining"), false);
  const wet = calcCarpentry({ packageId: "wet", measures: { lining: { length: 5, width: 2.4, wastePct: 12 }, vanity: { qty: 1 } } });
  assert.equal(line(wet, "lining").qty, 13.44);
  assert.equal(line(wet, "lining").amount, 1048.32);
  assert.equal(line(wet, "vanity").amount, 420);
  assert.equal(wet.lines.some(l => l.id === "sheets"), false);
  const labour = calcCarpentry({
    packageId: "labour",
    hoursOnSite: 8,
    measures: { labourhours: { qty: 4 }, sheets: { length: 10, width: 2.4, wastePct: 0 } },
  });
  assert.equal(labour.lines.map(l => l.id).join(","), "labourhours");
  assert.equal(line(labour, "labourhours").amount, 340);
  assert.equal(labour.allocatedHours, 8);
  assert.equal(CARPENTRY.lines.some(l => /mix|mpa|slump|cement/i.test(l.id)), false);
});

test("tiling take-offs apply waste, and the wet-area template prices membrane without a test result", () => {
  assert.equal(placeholderRates(TILING).floor, 88);
  assert.equal(placeholderRates(TILING).wetfloor, 98);
  assert.equal(placeholderRates(TILING).membrane, 58);
  const floor = calcTiling({
    packageId: "floor",
    measures: { floor: { length: 6, width: 4, wastePct: 10 }, screed: { length: 6, width: 4, wastePct: 5 }, wetfloor: { length: 2, width: 2, wastePct: 0 } },
  });
  assert.equal(line(floor, "floor").qty, 26.4);
  assert.equal(line(floor, "floor").amount, 2323.2);
  assert.equal(line(floor, "screed").qty, 25.2);
  assert.equal(floor.lines.some(l => l.id === "wetfloor" || l.id === "membrane"), false);
  const wet = calcTiling({
    packageId: "wet",
    measures: {
      wetfloor: { length: 4, width: 3, wastePct: 15 },
      wetwall: { length: 8, width: 2.1, wastePct: 15 },
      membrane: { length: 4, width: 3, wastePct: 10 },
    },
  });
  assert.equal(line(wet, "wetfloor").qty, 13.8);
  assert.equal(line(wet, "wetfloor").amount, 1352.4);
  assert.equal(line(wet, "wetwall").qty, 19.32);
  assert.equal(line(wet, "membrane").qty, 13.2);
  assert.equal(line(wet, "membrane").lineType, "material");
  const labour = calcTiling({ packageId: "labour", measures: { tilelabour: { qty: 5 }, floor: { length: 3, width: 3, wastePct: 0 } } });
  assert.equal(labour.lines.map(l => l.id).join(","), "tilelabour");
  assert.equal(line(labour, "tilelabour").amount, 390);
  const quoted = calcTiling({
    packageId: "floor",
    measures: { floor: { length: 2, width: 2, wastePct: 0 } },
    quotePrices: { floor: 10.35 },
  }, { floor: 90 });
  assert.equal(line(quoted, "floor").rate, 10.35);
  assert.equal(line(quoted, "floor").rateSource, "quote");
  assert.equal(quoted.gst, 4.14);
});

test("plumbing templates add parts, labour and certificate costs, and leave other templates out", () => {
  assert.equal(placeholderRates(PLUMBING).pipe, 42);
  assert.equal(placeholderRates(PLUMBING).permit, 290);
  assert.equal(placeholderRates(PLUMBING).certificate, 175);
  const rough = calcPlumbing({
    packageId: "rough",
    hoursOnSite: 6,
    measures: {
      points: { qty: 4 },
      pipe: { length: 20, wastePct: 10 },
      labouradd: { qty: 3 },
      permit: { qty: 1 },
      drainpipe: { length: 15, wastePct: 0 },
    },
  });
  assert.equal(line(rough, "points").amount, 660);
  assert.equal(line(rough, "points").lineType, "labour");
  assert.equal(line(rough, "pipe").qty, 22);
  assert.equal(line(rough, "pipe").amount, 924);
  assert.equal(line(rough, "pipe").lineType, "material");
  assert.equal(line(rough, "labouradd").amount, 294);
  assert.equal(line(rough, "permit").amount, 290);
  assert.equal(line(rough, "permit").lineType, "compliance");
  assert.equal(rough.lines.some(l => l.id === "drainpipe" || l.id === "certificate"), false);
  assert.equal(rough.allocatedHours, 6);
  const gas = calcPlumbing({ packageId: "gas", measures: { gaspoints: { qty: 2 }, gaspipe: { length: 10, wastePct: 8 }, certificate: { qty: 1 } } });
  assert.equal(line(gas, "gaspoints").amount, 390);
  assert.equal(line(gas, "gaspipe").qty, 10.8);
  assert.equal(line(gas, "gaspipe").amount, 561.6);
  assert.equal(line(gas, "certificate").lineType, "compliance");
  assert.equal(line(gas, "certificate").amount, 175);
  assert.equal(gas.lines.some(l => l.id === "points"), false);
  assert.equal(PLUMBING.lines.some(l => /mix|mpa|testresult|stage/i.test(l.id)), false);
});

test("electrical templates add parts, labour and permit or certificate costs", () => {
  assert.equal(placeholderRates(ELECTRICAL).cable, 12);
  assert.equal(placeholderRates(ELECTRICAL).permit, 340);
  assert.equal(placeholderRates(ELECTRICAL).certificate, 175);
  assert.equal(placeholderRates(ELECTRICAL).callout, 150);
  const rough = calcElectrical({
    packageId: "rough",
    measures: {
      epoints: { qty: 8 },
      cable: { length: 30, wastePct: 15 },
      efittings: { qty: 8 },
      certificate: { qty: 1 },
      callout: { qty: 1 },
    },
  });
  assert.equal(line(rough, "epoints").amount, 680);
  assert.equal(line(rough, "cable").qty, 34.5);
  assert.equal(line(rough, "cable").amount, 414);
  assert.equal(line(rough, "efittings").amount, 256);
  assert.equal(line(rough, "efittings").lineType, "material");
  assert.equal(line(rough, "certificate").lineType, "compliance");
  assert.equal(line(rough, "certificate").amount, 175);
  assert.equal(rough.lines.some(l => l.id === "callout"), false);
  const fault = calcElectrical({ packageId: "fault", hoursOnSite: 2, includeLabour: true, measures: { callout: { qty: 1 }, faultparts: { qty: 2 }, labouradd: { qty: 1.5 } } });
  assert.equal(line(fault, "callout").amount, 150);
  assert.equal(line(fault, "faultparts").amount, 90);
  assert.equal(line(fault, "labouradd").amount, 147);
  assert.equal(line(fault, "labour").qty, 2);
  assert.equal(line(fault, "labour").amount, 196);
  assert.equal(fault.allocatedHours, 2);
  assert.equal(fault.lines.some(l => l.id === "cable" || l.id === "permit"), false);
  const job = measuredJobFields({
    packId: "electrical",
    description: "Safety certificate $175 ex GST",
    hoursOnSite: 2,
    lines: fault.lines,
  });
  assert.equal(job.allocatedHours, 2);
  assert.doesNotMatch(job.description, /\$|175/);
  assert.equal(JSON.stringify(job.quote).includes("175"), false);
  const esc = s => String(s ?? "");
  const form = measureSetupHtml(ELECTRICAL, { packageId: "rough", measures: {} }, esc);
  assert.match(form, /Electrical safety certificate/);
  assert.match(form, /not required before the job can be marked done/);
  assert.match(form, /defaults to review/i);
});
