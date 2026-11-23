// Heartwood keeps its five SWMS. Every other company starts with none, and no reminder.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_ORG } from "../app/org-settings.js";
import {
  SWMS, SWMS_EMPTY, SWMS_VERSION, companySwms, swmsReminderModel, swmsSignoffOrg,
} from "../app/features/swms-sign.js";

const NOW = Date.parse("2026-11-15T10:00:00+10:00");
const HEARTWOOD_IDS = [
  "working-near-roads", "mobile-plant", "working-with-silica", "hazardous-substances", "electrical",
];

function unsigned(companyId) {
  return swmsReminderModel(companyId, [], "worker-1", NOW);
}

test("Heartwood gets the five SWMS and a reminder when they are unsigned", () => {
  assert.equal(SWMS.length, 5);
  assert.deepEqual(companySwms("heartwood").map(row => row[0]), HEARTWOOD_IDS);
  assert.deepEqual(companySwms("").map(row => row[0]), HEARTWOOD_IDS);
  assert.deepEqual(companySwms(undefined).map(row => row[0]), HEARTWOOD_IDS);
  const remind = unsigned("heartwood");
  assert.ok(remind);
  assert.equal(remind.exp, 5);
  assert.equal(remind.due, 0);
  assert.deepEqual(remind.titles, [
    "Working near roads", "Mobile plant", "Working with silica", "Hazardous substances", "Electrical & underground services",
  ]);
  const signed = SWMS.map(([id]) => ({
    uid: "worker-1", swmsId: id, version: SWMS_VERSION, signedAtMs: Date.parse("2026-06-01T10:00:00+10:00"),
  }));
  assert.equal(swmsReminderModel("heartwood", signed, "worker-1", NOW), null);
});

test("another company gets no SWMS and no reminder", () => {
  for (const id of ["northbank-ab12", "callup-test-h2vx", "signup-k3m9"]) {
    assert.deepEqual(companySwms(id), []);
    assert.equal(unsigned(id), null);
  }
  const heartwoodSigs = SWMS.map(([id]) => ({
    uid: "worker-1", swmsId: id, version: "2025-07", signedAtMs: Date.parse("2024-01-01T10:00:00+10:00"),
  }));
  assert.equal(swmsReminderModel("northbank-ab12", heartwoodSigs, "worker-1", NOW), null);
  assert.equal(SWMS_EMPTY, "No SWMS set up for your company yet.");
});

test("a signed SWMS sheet never puts Heartwood's name or ABN on another company", () => {
  const heartwood = swmsSignoffOrg({
    companyId: "heartwood",
    name: DEFAULT_ORG.name,
    legalName: DEFAULT_ORG.legalName,
    abn: DEFAULT_ORG.abn,
  }, "heartwood");
  assert.equal(heartwood.legalName, "Heartwood Earthworx Pty Ltd");
  assert.equal(heartwood.abn, "31 667 738 098");

  const own = swmsSignoffOrg({
    name: "Northbank Civil",
    legalName: "Northbank Civil Pty Ltd",
    abn: "11 222 333 444",
    address: "1 Yard St",
    email: "office@northbank.example",
  }, "northbank-ab12");
  assert.equal(own.legalName, "Northbank Civil Pty Ltd");
  assert.equal(own.abn, "11 222 333 444");
  assert.equal(own.address, "1 Yard St");
  assert.doesNotMatch(JSON.stringify(own), /Heartwood|31 667 738 098/);

  const leaked = swmsSignoffOrg({ ...DEFAULT_ORG }, "northbank-ab12");
  assert.equal(leaked.abn, "");
  assert.equal(leaked.address, "");
  assert.equal(leaked.email, "");
  assert.doesNotMatch(leaked.legalName + leaked.name, /Heartwood/);
});

test("the app hides reminders, View SWMS and the placeholder for a company with no SWMS", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /function swmsReminderHtml\(\) \{[\s\S]*?swmsReminderModel\(/);
  assert.match(app, /if \(!model\) return "";/);
  assert.match(app, /if \(!companyHasSwms\(\)\) return `<div class="sm-head"><h1>SWMS<\/h1><\/div>\$\{swmsEmptyHtml\(\)\}`;/);
  assert.match(app, /companyHasSwms\(\) \? ` <button type="button" class="sm-btn" data-swms=/);
  assert.match(app, /companyHasSwms\(\) \? `<button type="button" class="mnote" data-swms=/);
  assert.match(app, /if \(!isHeartwoodCompany\(myCompanyId\(\)\)\) return null;/);
  assert.match(app, /swmsSignoffOrg\(orgSettings\(\), myCompanyId\(\)\)/);
  assert.match(app, /Report incident/);
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v147-help-videos/);
});

test("helper knowledge says SWMS are Heartwood-only and other companies start with none", () => {
  const topic = readFileSync(new URL("../docs/knowledge/07-safety-swms.md", import.meta.url), "utf8");
  const pack = readFileSync(new URL("../docs/knowledge/callup-knowledge.md", import.meta.url), "utf8");
  for (const text of [topic, pack]) {
    assert.match(text, /Heartwood-only for now/);
    assert.match(text, /other companies start with none/i);
    assert.match(text, /No SWMS set up for your company yet/);
  }
  assert.match(pack.slice(0, 10000), /other companies start with none/i);
});
