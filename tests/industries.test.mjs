import test from "node:test";
import assert from "node:assert/strict";
import { TRADES, DEFAULT_TRADE, QUOTE_PACKS, companyTradesDoc, defaultTitles, quotePack, resolveCompanySetup, signupTradesHtml } from "../app/features/trades.js";
import { addPresetRow, jobStepsHtml, jobStepsScopeLabel, mergeIndustryPresets, pestControlOn, presetEditorHtml, readPresetEditor, stepsForJob } from "../app/features/industry-presets.js";
import { RECURRENCE_HINTS } from "../app/features/packs/service-trades.js";
import { calcMeasured } from "../app/features/packs/money.js";

const NEW_IDS = ["cleaning", "property-maintenance", "pest-control", "skip-bins", "pools", "solar-aircon", "traffic-control", "civil-earthworks"];

test("earthworks stays the default and the industries are selectable", () => {
  assert.equal(DEFAULT_TRADE, "earthworks");
  const ids = TRADES.map(row => row.id);
  assert.equal(ids[0], "earthworks");
  for (const id of NEW_IDS) assert.ok(ids.includes(id), id);
  const html = signupTradesHtml(["earthworks"]);
  assert.match(html, /Cleaning crews/);
  assert.match(html, /Property maintenance/);
  assert.match(html, /Pest control/);
  assert.match(html, /Skip bins and rubbish/);
  assert.match(html, /Pools and irrigation/);
  assert.match(html, /Solar and air conditioning/);
  assert.match(html, /Traffic control/);
  assert.match(html, /Civil and earthworks/);
  assert.doesNotMatch(html, /Traffic control and civil/);
  assert.match(html, /value="earthworks" checked/);
});

test("each new industry has titles, job types, a quote pack and sample lines", () => {
  for (const id of NEW_IDS) {
    const pack = quotePack(id);
    assert.equal(pack.ready, true, id);
    assert.equal(pack.wizard, "measure", id);
    assert.ok(pack.lineItems.length >= 3, id);
    assert.ok(defaultTitles([id]).some(row => row.level === "admin"), id);
    const setup = resolveCompanySetup({ trades: [id] }, null);
    assert.ok(setup.checklists.length > 0, id);
    assert.ok(setup.photoSteps.length > 0, id);
  }
  assert.equal(defaultTitles(TRADES.map(row => row.id)).length <= 80, true);
});

test("cleaning preloads before and after photos and a checklist", () => {
  const setup = resolveCompanySetup({ trades: ["cleaning"] }, null);
  const steps = stepsForJob(setup, "cl-eol");
  assert.ok(steps.photoSteps.some(row => /Before photo/.test(row.label)));
  assert.ok(steps.photoSteps.some(row => /After photo/.test(row.label)));
  assert.ok(steps.checklists.some(row => /end of lease/i.test(row.label)));
});

test("site cleans stay on earthworks with before and after photos", () => {
  const setup = resolveCompanySetup({ companyId: "heartwood" }, null);
  assert.deepEqual(setup.enabled, ["earthworks"]);
  const steps = stepsForJob(setup, "clean");
  assert.ok(steps.photoSteps.some(row => row.label === "Before photo"));
  assert.ok(steps.photoSteps.some(row => row.label === "After photo"));
});

test("changing industry keeps a custom checklist and does not keep an untouched one", () => {
  const first = resolveCompanySetup({ trades: ["cleaning"] }, null);
  const added = addPresetRow(first, { label: "Our extra room check", kind: "check" });
  const stored = { checklists: added.checklists, photoSteps: first.photoSteps, titles: [{ id: "custom:clerk", name: "Clerk", level: "supervisor", trade: "cleaning", custom: true }] };
  const next = resolveCompanySetup({ trades: ["pest-control"] }, stored);
  assert.ok(next.checklists.some(row => row.label === "Our extra room check"));
  assert.equal(next.checklists.some(row => row.id === "cl-scope"), false);
  assert.ok(next.checklists.some(row => row.trade === "pest-control"));
  assert.ok(next.titles.some(row => row.name === "Clerk" && row.custom === true));
});

test("skip bins quote in m3, tonnes and loads, with GST on top of the sample rates", () => {
  const pack = QUOTE_PACKS["skip-bins"].data;
  const measures = { "sk-m3-line": { length: 2, width: 1, depth: 1 }, "sk-t-line": { qty: 3 }, "sk-loads-line": { qty: 2 } };
  const calc = calcMeasured(pack, { packageId: "standard", measures, includeLabour: false }, {});
  assert.equal(calc.ok, true);
  const labels = calc.lines.map(line => line.name + " " + line.unit).join(" | ");
  assert.match(labels, /m3/);
  assert.match(labels, /\bt\b/);
  assert.match(labels, /loads/);
  assert.equal(calc.gst, Math.round(Math.round(calc.totalEx * 100) / 10) / 100);
  assert.ok(calc.totalInc > calc.totalEx);
});

test("pest, pool, lawn and cleaning visits suggest a repeat", () => {
  assert.equal(RECURRENCE_HINTS["pc-general"].freq, "quarterly");
  assert.equal(RECURRENCE_HINTS["po-service"].freq, "weekly");
  assert.equal(RECURRENCE_HINTS["pm-lawn"].freq, "fortnightly");
  assert.equal(RECURRENCE_HINTS["cl-commercial"].freq, "weekly");
});

test("Heartwood site cleans keep photos and hide the checklist", () => {
  const setup = resolveCompanySetup({ companyId: "heartwood" }, null);
  assert.equal(pestControlOn(setup), false);
  assert.ok(setup.checklists.some(row => /Walk the site/.test(row.label)));
  const job = { id: "HW-9233", type: "clean", client: "Torsion", address: "Torsion site clean" };
  const html = jobStepsHtml(job, setup);
  assert.match(html, /<h3>Photos<\/h3>/);
  assert.match(html, /Before photo/);
  assert.match(html, /After photo/);
  assert.doesNotMatch(html, /Checklist/);
  assert.doesNotMatch(html, /Walk the site/);
  assert.equal(jobStepsScopeLabel(job, setup), "Photos");
  const editor = presetEditorHtml(setup, { canEdit: true });
  assert.match(editor, /<h2>Photos<\/h2>/);
  assert.match(editor, /Before photo/);
  assert.match(editor, /name="kind" value="photo"/);
  assert.doesNotMatch(editor, /Checklist/);
  assert.doesNotMatch(editor, /certificate/i);
  assert.doesNotMatch(editor, /value="check"/);
  const root = {
    querySelectorAll(sel) {
      if (sel !== "[data-preset-row]") return [];
      return [{
        getAttribute(name) {
          if (name === "data-preset-kind") return "photo";
          if (name === "data-preset-row") return "ew-clean-before";
          return "";
        },
        querySelector() { return { value: "Before photo renamed" }; },
      }];
    },
  };
  const read = readPresetEditor(root, setup);
  assert.ok(read.checklists.some(row => /Walk the site/.test(row.label)));
  assert.ok(read.photoSteps.some(row => row.label === "Before photo renamed"));
});

test("a checklist shows only when the company includes pest control", () => {
  const pest = resolveCompanySetup({ trades: ["pest-control"] }, null);
  const pestJob = { type: "pc-general", address: "4 Garden Ave" };
  const pestHtml = jobStepsHtml(pestJob, pest);
  assert.match(pestHtml, /Checklist and photos/);
  assert.match(pestHtml, /Identify the pest/);
  assert.equal(jobStepsScopeLabel(pestJob, pest), "Checklist");
  const pestEditor = presetEditorHtml(pest, { canEdit: true });
  assert.match(pestEditor, /<h2>Checklists and photos<\/h2>/);
  assert.match(pestEditor, /value="check"/);
  assert.match(pestEditor, /certificate/i);
  const mixed = resolveCompanySetup({ trades: ["earthworks", "pest-control"] }, null);
  assert.equal(pestControlOn(mixed), true);
  assert.match(jobStepsHtml({ type: "clean" }, mixed), /Checklist/);
  for (const id of ["cleaning", "property-maintenance", "skip-bins", "pools", "solar-aircon", "traffic-control", "civil-earthworks", "plumbing", "electrical"]) {
    const setup = resolveCompanySetup({ trades: [id] }, null);
    assert.equal(pestControlOn(setup), false, id);
    const type = setup.photoSteps[0] && setup.photoSteps[0].jobTypes && setup.photoSteps[0].jobTypes[0];
    const html = jobStepsHtml({ type }, setup);
    if (html) {
      assert.match(html, /<h3>Photos<\/h3>/, id);
      assert.doesNotMatch(html, /Checklist/, id);
    }
    const editor = presetEditorHtml(setup, { canEdit: true });
    assert.doesNotMatch(editor, /Checklist/, id);
    assert.doesNotMatch(editor, /certificate/i, id);
    if (NEW_IDS.includes(id)) assert.ok(setup.checklists.length > 0, id);
  }
});

test("quoting and repeating visits stay available outside pest control", () => {
  assert.equal(quotePack("cleaning").ready, true);
  assert.equal(quotePack("earthworks").ready, true);
  assert.equal(RECURRENCE_HINTS["cl-commercial"].freq, "weekly");
  assert.equal(RECURRENCE_HINTS["po-service"].freq, "weekly");
  assert.equal(RECURRENCE_HINTS["pc-general"].freq, "quarterly");
  const cleaning = resolveCompanySetup({ trades: ["cleaning"] }, null);
  const added = addPresetRow(cleaning, { label: "Our extra room check", kind: "check" });
  assert.equal(added.ok, true);
  assert.ok(added.checklists.some(row => row.label === "Our extra room check"));
});

test("a new company document carries the industry presets", () => {
  const doc = companyTradesDoc("acme", ["cleaning", "pest-control"], "u1");
  assert.equal(doc.trade, "cleaning");
  assert.ok(doc.checklists.length > 0);
  assert.ok(doc.photoSteps.some(row => row.trade === "pest-control"));
  const merged = mergeIndustryPresets(doc, ["cleaning"]);
  assert.equal(merged.photoSteps.some(row => row.trade === "pest-control" && row.custom !== true), false);
});
