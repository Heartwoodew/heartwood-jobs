// Coral Homes job requirements. Pack text only. No prices, and no email parser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLEAN_STAGES, CORAL_CLIENT, REQUIREMENT_COST_CODES, buildTemplateItems, canonicalClientName,
  coralTemplateDoc, crewRequirementsHtml, detectCleanStage, detectStorey, isCoralClient, isNswJob,
  isPortMacquarie, itemWriteBody, officeRequirementsHtml, packKind, planRequirementWrite, requirementText,
} from "../../app/features/job-requirements.js";
import { CORAL_COST_CODE_MAP, coralCallupHook, parseInboxEmail } from "../../app/features/inbox-import.js";
import { HEARTWOOD_CLIENTS } from "../../app/features/company.js";

const MONEY = /\$|\bex\.?\s*GST\b|\btip fees?\b|\brates?\b/i;
const QLD = { address: "Lot 2, 14 Ironbark St, Ipswich QLD", state: "QLD" };

function coral(extra) {
  return { client: CORAL_CLIENT, companyId: "heartwood", ...QLD, ...extra };
}
function texts(job) {
  return planRequirementWrite(job, [], { companyId: "heartwood", uid: "office" }).items.map(item => item.text);
}
function has(list, pattern) {
  return list.some(line => pattern.test(line));
}

test("requirement text drops prices, ex GST, tip fees and rates, and keeps ordinary words", () => {
  assert.equal(requirementText("Pay $50 ex GST"), "Pay");
  assert.equal(requirementText("tip fee then $12"), "then");
  assert.equal(requirementText("the day rate"), "the day");
  assert.equal(requirementText("AU$1,200 inc GST tip fees"), "");
  assert.equal(requirementText("separate spoil"), "separate spoil");
  assert.equal(requirementText("Pay $50 ex GST"), "Pay");
});

test("Coral Homes is a client, and the short name is an alias of the legal name", () => {
  assert.ok(HEARTWOOD_CLIENTS.includes(CORAL_CLIENT));
  assert.equal(canonicalClientName("Coral Homes"), CORAL_CLIENT);
  assert.equal(canonicalClientName("  coral homes qld pty ltd "), CORAL_CLIENT);
  assert.equal(canonicalClientName("Silkwood Homes"), "Silkwood Homes");
  assert.equal(isCoralClient("Coral"), false);
  assert.equal(isCoralClient("Coral Homes Qld"), true);
});

test("pack selection covers each type and clean stage", () => {
  const cases = [
    [{ type: "spoil" }, "spoil", "", "Record the loads."],
    [{ type: "spoil", costCode: "197100" }, "spoil", "", "An official purchase order is required before spoil is exported."],
    [{ type: "backslab" }, "setup", "", "before back-blading"],
    [{ type: "other", costCode: "297000" }, "setup", "", "working platform does not pond"],
    [{ type: "other", costCode: "297200" }, "setup", "", "R82 mesh"],
    [{ type: "other", costCode: "526210" }, "setup", "", "leftover steel"],
    [{ type: "earthworks", costCode: "195210" }, "earthworks", "", "within 25 mm"],
    [{ type: "cut-and-fill", description: "cut and fill" }, "earthworks", "", "78% or more"],
    [{ type: "clean", costCode: "6350015" }, "clean", "first", "Handpicked clean, 2 men / 1 hour."],
    [{ type: "clean", costCode: "6360015", description: "second clean lowset cladding" }, "clean", "second-lowset", "cladding and linings"],
    [{ type: "clean", costCode: "6360017", description: "second clean highset" }, "clean", "second-highset", "Second clean, highset."],
    [{ type: "clean", costCode: "6370015" }, "clean", "third", "wet-area tiling"],
    [{ type: "clean", costCode: "6380015", description: "practical completion" }, "clean", "final", "not landscaping"],
  ];
  for (const [extra, kind, stage, needle] of cases) {
    const job = coral(extra);
    const plan = planRequirementWrite(job, [], { companyId: "heartwood", uid: "office" });
    assert.equal(plan.apply, true, JSON.stringify(extra));
    assert.equal(plan.kind, kind, JSON.stringify(extra));
    assert.equal(plan.cleanStage, stage, JSON.stringify(extra));
    assert.equal(packKind(job), kind);
    const body = texts(job).join("\n");
    assert.match(body, new RegExp(needle), JSON.stringify(extra));
    assert.doesNotMatch(body, MONEY, JSON.stringify(extra));
    assert.match(body, /SWMS supplied and on site/);
    assert.match(body, /All waste off site \(Schedule 2\)\./);
  }
});

test("clean stages do not borrow another stage's labour line", () => {
  const markers = {
    first: "Handpicked clean, 2 men / 1 hour.",
    "second-lowset": "Second clean, lowset, for cladding and linings.",
    "second-highset": "Second clean, highset.",
    third: "Third clean when wet-area tiling is complete",
    final: "Final clean at practical completion.",
  };
  for (const stage of CLEAN_STAGES) {
    const lines = texts(coral({ type: "clean", cleanStage: stage }));
    assert.ok(lines.some(line => line.includes(markers[stage])), stage);
    for (const [other, marker] of Object.entries(markers)) {
      if (other === stage) continue;
      assert.equal(lines.some(line => line.includes(marker)), false, `${stage} included ${other}`);
    }
  }
});

test("storey, New South Wales and Port Macquarie change only the lines that depend on them", () => {
  const single = texts(coral({ type: "clean", cleanStage: "second-lowset", storey: "single" }));
  const two = texts(coral({ type: "clean", cleanStage: "second-lowset", storey: "two", description: "two-storey second clean" }));
  assert.equal(has(single, /scaffold is down/), false);
  assert.equal(has(two, /after the bricks and plaster/), true);
  assert.equal(has(two, /once the scaffold is down/), true);
  assert.equal(detectStorey({ description: "second clean highset" }), "");
  assert.equal(detectStorey({ description: "two storey home" }), "two");
  assert.equal(detectCleanStage({ description: "second clean highset" }), "second-highset");

  const qld = texts(coral({ type: "clean", cleanStage: "final", storey: "single" }));
  const nsw = texts(coral({ type: "clean", cleanStage: "first", state: "NSW", address: "1 Hunter St, Newcastle NSW" }));
  const port = texts(coral({ type: "clean", cleanStage: "final", address: "9 Shore St, Port Macquarie" }));
  assert.equal(has(qld, /Queensland RCS/), true);
  assert.equal(has(qld, /New South Wales/), false);
  assert.equal(has(qld, /^Plasterboard is recycled by others\.$/), true);
  assert.equal(has(qld, /Port Macquarie/), false);
  assert.equal(isNswJob({ state: "NSW" }), true);
  assert.equal(has(nsw, /New South Wales silica/), true);
  assert.equal(has(nsw, /Queensland RCS/), false);
  assert.equal(has(nsw, /^Plasterboard is recycled by others\.$/), true);
  assert.equal(isPortMacquarie({ address: "Port Macquarie" }), true);
  assert.equal(has(port, /In Port Macquarie, plasterboard is not recycled by others\./), true);
  assert.equal(has(port, /New South Wales silica/), true);
  assert.equal(has(port, /^Plasterboard is recycled by others\.$/), false);
});

test("a non-Coral job stays empty, and Schedule 2 is not invented", () => {
  const plan = planRequirementWrite({
    client: "Silkwood Homes", type: "clean", costCode: "6380015", description: "final clean",
    address: "1 St, Port Macquarie NSW",
  }, [], { companyId: "heartwood", uid: "office" });
  assert.equal(plan.apply, false);
  assert.deepEqual(plan.items, []);
  const coralLines = texts(coral({ type: "clean", cleanStage: "final", storey: "two" }));
  for (const line of coralLines) {
    if (line.includes("Schedule 2")) assert.equal(line, "All waste off site (Schedule 2).");
  }
  assert.equal(coralLines.join("\n").includes("waste must be"), false);
});

test("re-applying keeps custom lines and ticks, and drops template lines that no longer apply", () => {
  const job = coral({ type: "clean", cleanStage: "first", storey: "single" });
  const first = planRequirementWrite(job, [], { companyId: "heartwood", uid: "office" });
  const swms = first.items.find(item => item.text.startsWith("SWMS"));
  swms.done = true;
  swms.doneBy = "op1";
  const custom = {
    id: "rcustomkeep1234", section: "shared", text: "Gate code is on the box", source: "custom",
    sort: 4, done: true, doneBy: "op1", companyId: "heartwood",
  };
  const next = planRequirementWrite(
    { ...job, storey: "two", cleanStage: "final" },
    [...first.items, custom],
    { companyId: "heartwood", uid: "office", force: true, notes: "Access: side gate" },
  );
  const kept = next.items.find(item => item.text.startsWith("SWMS"));
  assert.equal(kept.done, true);
  assert.equal(kept.doneBy, "op1");
  const note = next.items.find(item => item.id === custom.id);
  assert.equal(note.source, "custom");
  assert.equal(note.text, "Gate code is on the box");
  assert.equal(note.done, true);
  assert.equal(next.items.some(item => /Handpicked clean/.test(item.text)), false);
  assert.ok(next.items.some(item => /scaffold is down/.test(item.text)));
  assert.equal(next.meta.notes, "Access: side gate");
  assert.equal(next.meta.storey, "two");
  assert.equal(next.meta.cleanStage, "final");
});

test("crew and office views show no money, and the crew view is a tick list", () => {
  const plan = planRequirementWrite(coral({ type: "spoil" }), [], { companyId: "heartwood", uid: "sam" });
  const poisoned = {
    id: "rcustompoison1", section: "spoil", source: "custom", sort: 900, done: false,
    text: "Tip fee $40 ex GST at the day rate",
  };
  const crew = crewRequirementsHtml({ items: [...plan.items, poisoned] });
  const office = officeRequirementsHtml({
    items: [...plan.items, { ...poisoned, source: "custom" }],
    meta: { ...plan.meta, updatedBy: "sam" },
    editorName: "Sam",
  });
  for (const html of [crew, office]) {
    assert.doesNotMatch(html, MONEY);
    assert.doesNotMatch(html, /Xero|profit graph|job chat|artificial intelligence/i);
  }
  assert.match(crew, /type="checkbox"/);
  assert.doesNotMatch(crew, /<textarea|<input (?!type="checkbox")/);
  assert.match(office, /Apply template/);
  assert.match(office, /data-req-storey/);
  assert.match(office, /data-req-stage/);
  assert.match(office, />Template</);
  assert.match(office, />Custom</);
  assert.match(office, /Last edited by Sam/);
  assert.equal(crewRequirementsHtml({ items: [] }), `<p class="req-empty">No requirements yet</p>`);
  assert.match(officeRequirementsHtml({ items: [], meta: null }), /No requirements yet/);
  const body = itemWriteBody(poisoned, { companyId: "heartwood", uid: "sam", create: true, serverTimestamp: () => "ts" });
  for (const key of ["poAmount", "quoteAmount", "invoiceAmount", "rate", "tipFee", "price", "cost", "totalEx", "gst"]) {
    assert.equal(Object.hasOwn(body, key), false);
  }
  assert.doesNotMatch(body.text, MONEY);
  const template = JSON.stringify(coralTemplateDoc("heartwood"));
  assert.doesNotMatch(template, MONEY);
  assert.match(template, /coral-homes/);
});

test("the Coral cost-code map is documentation for a later parser, and current parsers stay", () => {
  assert.equal(coralCallupHook({ subject: "Coral Homes call up", text: "Lot 1, 2 Main St. Cost code 6350015. $80 ex GST" }), null);
  assert.deepEqual(Object.keys(CORAL_COST_CODE_MAP).sort(), Object.keys(REQUIREMENT_COST_CODES).sort());
  for (const [code, row] of Object.entries(CORAL_COST_CODE_MAP)) {
    assert.equal(REQUIREMENT_COST_CODES[code].pack, row.pack);
    assert.equal(REQUIREMENT_COST_CODES[code].stage || "", row.stage || "");
    assert.equal(JSON.stringify(row).includes("$"), false);
  }
  const orbit = parseInboxEmail({
    subject: "Orbit call up",
    fromEmail: "site@orbit.example",
    text: "Orbit Homes. Lot 1, 2 Wattle St, Springfield. Spoil removal. Required date 20/11/2026. PO AB12/900/02.",
  }, { today: "2026-11-26" });
  assert.equal(orbit.client, "Orbit Homes (Qld) Pty Ltd");
  assert.equal(orbit.type, "spoil");
  const coralMail = parseInboxEmail({
    subject: "Coral Homes",
    text: "Coral Homes site clean. Lot 4, 8 Palm St, Ipswich. Cost code 6350015. $500 ex GST tip fee.",
  }, { today: "2026-11-26" });
  assert.equal(coralMail.client, "");
  const presets = readFileSync(new URL("../../app/features/industry-presets.js", import.meta.url), "utf8");
  assert.equal(presets.includes("coral-homes"), false);
  assert.equal(presets.includes("Schedule 2"), false);
});

test("the office tab, the crew tab and the rules are wired, with no prices in the shell", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const tabsAt = app.indexOf("function jobTabs");
  const tabs = app.slice(tabsAt, app.indexOf("const STD_CLIENTS", tabsAt));
  const detail = app.slice(app.indexOf("function renderOpDetail"), app.indexOf("const logEntry"));
  assert.match(tabs, /\["req", "Requirements"\]/);
  assert.match(detail, /data-jtab="req"/);
  assert.match(detail, />Requirements</);
  assert.match(detail, /No requirements yet|crewRequirementsHtml|mountJobRequirements/);
  assert.match(app, /planRequirementWrite\(coralJob/);
  assert.match(sw, /features\/job-requirements\.js/);
  assert.match(sw, /callup-shell-v161-requirements/);
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.requirements.rules", import.meta.url), "utf8");
  const slice = text => text.slice(text.indexOf("// BEGIN JOB REQUIREMENT RULES"), text.indexOf("// END JOB REQUIREMENT RULES") + "// END JOB REQUIREMENT RULES".length);
  assert.equal(slice(prod), slice(emu));
  assert.equal(slice(prod), frag.trimEnd());
  assert.match(slice(prod), /changed\.hasOnly\(\["done", "doneBy", "doneAt", "updatedBy"\]\)/);
  assert.match(slice(prod), /actor\.role in \["admin", "manager", "supervisor"\]/);
  assert.match(slice(prod), /company == "heartwood" \|\| companyNotPaused\(company\)/);
  assert.match(prod, /function companyOffice\(\) \{\s*let id = callerCompany\(\);\s*return id != "" && id != "heartwood"/);
});
