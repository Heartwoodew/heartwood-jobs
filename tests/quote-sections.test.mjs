import test from "node:test";
import assert from "node:assert/strict";
import { calcLandscaping } from "../app/features/packs/landscaping.js";
import { gstFromEx } from "../app/features/packs/money.js";
import {
  calcQuote, calcSections, categoryChoices, customerQuoteHtml, jobsFromAcceptedQuote, normalizeQuoteSections,
} from "../app/features/quotes.js";
import { commercialSnapshot, diffRevisions, revisionNeeded, sameCommercial } from "../app/features/quote-revisions.js";

const rates = {
  travelPerKm: 2, materialPerUnit: 30, tipPerLoad: 150,
  machineRates: {
    truck: { rate: 100, unit: "hour" },
    skid: { rate: 80, unit: "hour" },
    excavator: { rate: 120, unit: "hour" },
  },
  labourerRate: 45, labourerUnit: "hour",
};

function ew(id, type, hours, machines, extra = {}) {
  return {
    id, type, packId: "earthworks", label: type === "spoil" ? "Spoil removal" : "Site clean",
    hoursOnSite: hours, machines, workDay: 1, travelKm: 0, materialQty: 0, tipLoads: 0,
    includeLabourer: false, extraItems: [], priceOverrides: {}, ...extra,
  };
}

function moneyLines(calc) {
  return calc.lines.map(l => ({ key: l.key, qty: l.qty, rate: l.rate, amount: l.amount }));
}

test("a saved single-category earthworks quote prices identically as one section", () => {
  const input = {
    type: "spoil", hoursOnSite: 3, machines: ["truck", "skid"], travelKm: 12, materialQty: 2, tipLoads: 1,
    includeLabourer: true, priceOverrides: { "machine:truck": 180 },
    extraItems: [{ id: "a", kind: "custom", description: "Pump", qty: 1, unit: "each", unitPrice: 50, note: "" }],
  };
  const before = calcQuote(input, rates);
  const after = calcSections(input, rates);
  assert.equal(after.multi, false);
  assert.equal(after.sections.length, 1);
  assert.deepEqual(moneyLines(after), moneyLines(before));
  assert.equal(after.totalEx, before.totalEx);
  assert.equal(after.gst, before.gst);
  assert.equal(after.totalInc, before.totalInc);
  const again = calcSections({ sections: normalizeQuoteSections(input) }, rates);
  assert.equal(again.totalEx, before.totalEx);
  assert.equal(again.gst, before.gst);
  assert.deepEqual(moneyLines(again), moneyLines(before));
});

test("a saved single-category measured quote prices identically, including length width depth waste", () => {
  const input = {
    type: "ls-garden", packId: "landscaping", packageId: "soft", hoursOnSite: 4,
    measures: {
      turf: { length: 10, width: 5, wastePct: 5 },
      mulch: { length: 4, width: 2, depth: 0.1, wastePct: 10 },
    },
  };
  const before = calcLandscaping(input);
  const after = calcSections(input, {});
  assert.equal(after.multi, false);
  assert.equal(after.totalEx, before.totalEx);
  assert.equal(after.gst, before.gst);
  assert.equal(after.totalInc, before.totalInc);
  assert.equal(after.lines.find(l => l.id === "mulch").qty, before.lines.find(l => l.id === "mulch").qty);
  assert.equal(after.lines.find(l => l.id === "turf").amount, before.lines.find(l => l.id === "turf").amount);
});

test("a truck is charged once inside a section, same as the plant bundle", () => {
  const calc = calcSections({ type: "spoil", hoursOnSite: 2, machines: ["truck", "truck", "skid"], travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  assert.equal(calc.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(calc.lines.find(l => l.machineId === "truck").amount, 200);
  assert.equal(calc.totalEx, calcQuote({ hoursOnSite: 2, machines: ["truck", "skid"], travelKm: 0, materialQty: 0, tipLoads: 0 }, rates).totalEx);
});

test("two earthworks sections on the same day share one mobilisation when the hours match", () => {
  const calc = calcSections({
    sections: [
      ew("s1", "spoil", 4, ["truck", "skid"]),
      ew("s2", "clean", 4, ["truck", "skid"]),
    ],
  }, rates);
  assert.equal(calc.reviewNotes.length, 0);
  assert.equal(calc.lines.filter(l => l.machineId === "truck" && l.amount > 0).length, 1);
  assert.equal(calc.lines.filter(l => l.machineId === "skid" && l.amount > 0).length, 1);
  assert.equal(calc.totalEx, 4 * 100 + 4 * 80);
  assert.equal(calc.gst, gstFromEx(calc.totalEx).gst);
  assert.equal(calc.allocatedHours, 8);
  assert.equal(calc.sections[0].subtotalEx + calc.sections[1].subtotalEx, calc.totalEx);
});

test("different hours on the same day are charged once at the longer stay and flagged", () => {
  const calc = calcSections({
    sections: [
      ew("s1", "spoil", 4, ["truck", "excavator"]),
      ew("s2", "clean", 2, ["truck", "skid"]),
    ],
  }, rates);
  assert.equal(calc.lines.find(l => l.key === "s1:machine:truck").amount, 400);
  assert.equal(calc.lines.find(l => l.key === "s2:machine:truck").amount, 0);
  assert.equal(calc.lines.find(l => l.key === "s2:machine:truck").sharedMobilisation, true);
  assert.equal(calc.lines.find(l => l.machineId === "excavator").amount, 480);
  assert.equal(calc.lines.find(l => l.machineId === "skid").amount, 160);
  assert.equal(calc.totalEx, 400 + 480 + 160);
  assert.match(calc.reviewNotes.join(" "), /Truck/);
  assert.match(calc.reviewNotes.join(" "), /Check this before you send/);
  assert.equal(calc.allocatedHours, 6);
});

test("the same machine on a different day is charged again and not flagged", () => {
  const calc = calcSections({
    sections: [
      ew("s1", "spoil", 4, ["truck", "excavator"]),
      ew("s2", "clean", 2, ["truck", "skid"], { workDay: 2 }),
    ],
  }, rates);
  assert.equal(calc.lines.filter(l => l.machineId === "truck" && l.amount > 0).length, 2);
  assert.equal(calc.reviewNotes.length, 0);
  assert.equal(calc.totalEx, 4 * 100 + 4 * 120 + 2 * 100 + 2 * 80);
});

test("mixed sections have their own subtotals and one GST on the combined ex-GST total", () => {
  const calc = calcSections({
    description: "Wall, bed and turf",
    sections: [
      { id: "s1", type: "ls-retaining", packId: "landscaping", label: "Retaining", hoursOnSite: 3, packageId: "hard", measures: { retaining: { length: 8, width: 0.6, wastePct: 0 } } },
      { id: "s2", type: "ls-turf", packId: "landscaping", label: "Turf", hoursOnSite: 2, packageId: "soft", measures: { turf: { length: 1, width: 1, wastePct: 0 } }, quotePrices: { turf: 10.35 } },
      { id: "s3", type: "ls-garden", packId: "landscaping", label: "Garden build", hoursOnSite: 0, packageId: "soft", measures: { turf: { length: 1, width: 1, wastePct: 0 } }, quotePrices: { turf: 10.35 } },
    ],
  }, {});
  assert.equal(calc.sections[0].subtotalEx, 4.8 * 320);
  assert.equal(calc.sections[1].subtotalEx, 10.35);
  assert.equal(calc.sections[2].subtotalEx, 10.35);
  assert.equal(calc.totalEx, 1536 + 20.7);
  assert.equal(calc.gst, 155.67);
  assert.notEqual(calc.gst, 1.04 + 1.04 + gstFromEx(1536).gst);
  assert.equal(calc.totalInc, gstFromEx(calc.totalEx).totalInc);
  assert.equal(calc.allocatedHours, 5);
  const html = customerQuoteHtml({ client: "Orbit <b>", address: "1 Test St", dateIso: "2026-11-11T00:00:00Z", description: "Wall and turf" }, calc, { legalName: "Test Co" });
  assert.match(html, /<h2>Retaining<\/h2>/);
  assert.match(html, /<h2>Turf<\/h2>/);
  assert.match(html, /<h2>Garden build<\/h2>/);
  assert.match(html, /Orbit &lt;b&gt;/);
  assert.equal(html.match(/GST \(10%\)/g).length, 1);
  assert.match(html, /Total inc GST/);
});

test("accepting keeps one job with every category, or splits one job per section, with no prices on the job", () => {
  const calc = calcSections({
    sections: [
      ew("s1", "spoil", 4, ["truck", "excavator"]),
      ew("s2", "clean", 2, ["truck", "skid"]),
    ],
  }, rates);
  const quote = { client: "Orbit", address: "1 Test", description: "Spoil and clean $500 cash" };
  const one = jobsFromAcceptedQuote(quote, calc, "one");
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].types, ["spoil", "clean"]);
  assert.equal(one[0].type, "spoil");
  assert.equal(one[0].moneyEx, calc.totalEx);
  assert.equal(one[0].allocatedHours, 6);
  const split = jobsFromAcceptedQuote(quote, calc, "split");
  assert.equal(split.length, 2);
  assert.deepEqual(split.map(j => j.type), ["spoil", "clean"]);
  assert.equal(Math.round((split[0].moneyEx + split[1].moneyEx) * 100), Math.round(calc.totalEx * 100));
  for (const plan of [...one, ...split]) {
    const blob = JSON.stringify({ description: plan.description, workAmounts: plan.workAmounts, quote: plan.quote });
    assert.doesNotMatch(blob, /\$\d/);
    assert.doesNotMatch(blob, /unitPrice|"rate":|"amount":|totalEx|priceOverrides|gst/);
  }
});

test("a change in any section is one revision of the whole quote", () => {
  const garden = { id: "s1", type: "ls-garden", packId: "landscaping", label: "Garden build", hoursOnSite: 2, packageId: "soft", measures: { beds: { length: 2, width: 2, wastePct: 0 } } };
  const turf = { id: "s2", type: "ls-turf", packId: "landscaping", label: "Turf", hoursOnSite: 1, packageId: "soft", measures: { turf: { length: 3, width: 2, wastePct: 0 } } };
  const before = calcSections({ sections: [garden, turf] }, {});
  const after = calcSections({ sections: [{ ...garden, measures: { beds: { length: 3, width: 2, wastePct: 0 } } }, turf] }, {});
  assert.equal(sameCommercial(before, before), true);
  assert.equal(revisionNeeded({ revisionCount: 1, lines: before.lines, totalEx: before.totalEx, gst: before.gst, totalInc: before.totalInc }, after), true);
  const diff = diffRevisions(before, after);
  assert.equal(diff.lines.some(row => row.key.startsWith("s1:") && row.change === "changed"), true);
  assert.equal(diff.lines.some(row => row.key.startsWith("s2:") && row.change === "changed"), false);
  assert.ok(diff.totals.some(row => row.name === "totalEx"));
  assert.equal(commercialSnapshot(before).lines.length, before.lines.filter(l => l.key).length);
});

test("category ticks can come from every ready trade on the company", () => {
  const choices = categoryChoices({ enabled: ["earthworks", "landscaping", "plumbing"] });
  assert.deepEqual(choices.map(g => g.tradeId), ["earthworks", "landscaping", "plumbing"]);
  assert.ok(choices[1].categories.some(c => c.type === "ls-retaining" && c.label === "Retaining"));
  assert.ok(choices[0].categories.some(c => c.type === "spoil"));
});
