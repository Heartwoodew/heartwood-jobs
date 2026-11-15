import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcLandscaping, LANDSCAPING } from "../app/features/packs/landscaping.js";
import { calcConcreting, CONCRETING } from "../app/features/packs/concreting.js";
import { calcFencing, FENCING } from "../app/features/packs/fencing.js";
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
