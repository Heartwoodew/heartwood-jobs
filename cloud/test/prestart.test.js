import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALLUP_BASE } from "../../app/features/cloud-storage.js";
import { CALLUP_PLANS, canViewPrestart } from "../../app/features/compliance.js";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";
import {
  DEFAULT_PRESTART, itemsFor, missingToday, openDefects, prestartFormHtml, prestartPayload, templatePayload,
} from "../../app/features/prestart.js";

const asset = { id: "a1", type: "vehicle", name: "Preview tipper", rego: "PRE001" };

test("prestart is Pro and off on Base", () => {
  assert.equal(CALLUP_BASE.features.prestart, false);
  assert.equal(CALLUP_PLANS.base.features.prestart, false);
  assert.equal(CALLUP_PLANS.pro.features.prestart, true);
  assert.equal(canViewPrestart(CALLUP_PLANS.pro), true);
  assert.equal(canViewPrestart(CALLUP_PLANS.base), false);
  assert.equal(DEFAULT_PRESTART.trailer.includes("seatbelt"), false);
  assert.equal(DEFAULT_PRESTART.vehicle.includes("hydraulics"), true);
});

test("a fail needs a comment and opens a defect until an admin resolves it", () => {
  const items = itemsFor("vehicle", []);
  const answers = Object.fromEntries(items.map(item => [item.id, { result: "pass", comment: "" }]));
  answers.hydraulics = { result: "fail", comment: "" };
  assert.equal(prestartPayload({ asset, day: "2026-11-06", reading: "1280", readingUnit: "hours", answers, signerName: "Patrick", items }, "patrick").ok, false);
  answers.hydraulics.comment = "Weep at the ram";
  const built = prestartPayload({ asset, day: "2026-11-06", reading: "1280", readingUnit: "hours", answers, signerName: "Patrick", items }, "patrick");
  assert.equal(built.ok, true);
  assert.equal(built.data.defect, true);
  assert.equal(built.data.resolved, false);
  assert.equal(built.data.signerUid, "patrick");
  assert.equal("photo" in built.data, false);
  const open = openDefects([{ id: "ps1", ...built.data }]);
  assert.equal(open.length, 1);
  assert.equal(openDefects([{ ...built.data, resolved: true }]).length, 0);
  const missing = missingToday({
    assets: [asset, { id: "a2", name: "Preview trailer" }],
    prestarts: [{ assetId: "a1", day: "2026-11-06", signerUid: "patrick" }],
    jobs: [{ date: "2026-11-06", status: "Scheduled", assigned: ["patrick", "sam"], assignedNames: ["Patrick", "Sam"] }],
    today: "2026-11-06",
  });
  assert.deepEqual(missing.machines.map(item => item.id), ["a2"]);
  assert.deepEqual(missing.missingPeople, ["Sam"]);
  const form = prestartFormHtml({
    assets: [asset, { id: "plant1", type: "plant", name: "Excavator", rego: "EX1" }],
    assetId: "plant1", items: itemsFor("plant", []), signerName: "Test Worker", defects: [],
  });
  assert.match(form, /Preview tipper/);
  assert.match(form, /Excavator/);
  assert.match(form, /Any machine in the fleet/);
  assert.equal(form.includes("assigned to it"), true);
  const tpl = templatePayload("trailer", { tyres: { on: true, label: "Tyres" }, lights: { on: false, label: "Lights" } }, "admin");
  assert.equal(tpl.ok, true);
  assert.deepEqual(tpl.data.items, [{ id: "tyres", label: "Tyres" }]);
});

test("prestart rules are create-only for staff and do not widen storage", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.prestart.rules", import.meta.url), "utf8");
  const marker = "// END PRESTART RULES";
  const slice = emu.slice(emu.indexOf("// BEGIN PRESTART RULES"), emu.indexOf(marker) + marker.length);
  const fileSlice = frag.slice(frag.indexOf("// BEGIN PRESTART RULES"), frag.indexOf(marker) + marker.length);
  assert.equal(slice, fileSlice);
  assert.match(slice, /allow create: if psMember\(tenantId\) && psCreateOk\(\)/);
  assert.match(slice, /allow update: if psAdmin\(tenantId\) && psResolveOk\(\)/);
  assert.match(slice, /allow delete: if false/);
  assert.doesNotMatch(slice, /match \/receipts\/|match \/servicing\/|SCHEDULING_APPROVED/);
  assert.doesNotMatch(readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8"), /prestart/);
  assert.equal(SCHEDULING_APPROVED, false);
});
