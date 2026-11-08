import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALLUP_BASE } from "../../app/features/cloud-storage.js";
import { CALLUP_PLANS, canViewPrestart } from "../../app/features/compliance.js";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";
import {
  DEFAULT_PRESTART, PRESTART_KINDS, PRESTART_SECTIONS, assetKind, itemsFor, missingToday, openDefects,
  prestartFormHtml, prestartPayload, stopsOperation, templatePayload, templateReviewMarkdown, templateSeedDocs,
} from "../../app/features/prestart.js";

const asset = { id: "a1", type: "vehicle", prestartKind: "tip-truck", name: "Preview tipper", rego: "PRE001" };

test("prestart is Pro and off on Base", () => {
  assert.equal(CALLUP_BASE.features.prestart, false);
  assert.equal(CALLUP_PLANS.base.features.prestart, false);
  assert.equal(CALLUP_PLANS.pro.features.prestart, true);
  assert.equal(canViewPrestart(CALLUP_PLANS.pro), true);
  assert.equal(canViewPrestart(CALLUP_PLANS.base), false);
  assert.equal(DEFAULT_PRESTART.trailer.includes("seatbelt"), false);
  assert.equal(DEFAULT_PRESTART["tip-truck"].includes("tt-hyd"), true);
});

test("each machine kind has a sectioned default, and a critical fail means do not operate", () => {
  const sections = PRESTART_SECTIONS.map(([id]) => id);
  assert.deepEqual(PRESTART_KINDS.map(kind => kind.id), ["skid-steer", "excavator", "tip-truck", "ute", "trailer", "other-plant"]);
  for (const kind of PRESTART_KINDS) {
    const items = itemsFor(kind.id, []);
    assert.ok(items.length >= 8 && items.length <= 16, kind.id);
    assert.deepEqual([...new Set(items.map(item => item.section))], sections.filter(id => items.some(item => item.section === id)));
    for (const id of sections) assert.equal(items.some(item => item.section === id), true, kind.id + " " + id);
    assert.equal(items.some(item => item.critical), true, kind.id);
    for (const item of items) {
      assert.ok(item.label.length <= 60, item.label);
      assert.ok(item.id.length <= 40, item.id);
    }
    const ids = items.map(item => item.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(assetKind({ type: "plant" }), "other-plant");
  assert.equal(assetKind({ type: "trailer" }), "trailer");
  assert.equal(assetKind({ type: "vehicle", prestartKind: "tip-truck" }), "tip-truck");
  const review = templateReviewMarkdown();
  assert.match(review, /Skid steer \/ compact track loader/);
  assert.match(review, /Breakaway brake and cable — \*\*Do not operate\*\*/);
  assert.equal(templateSeedDocs([{ id: "ute" }], "admin").length, 0);
  const seeded = templateSeedDocs([], "admin");
  assert.deepEqual(seeded.map(row => row.id), PRESTART_KINDS.map(kind => kind.id));
  assert.equal(seeded[0].data.updatedBy, "admin");
  const saved = templatePayload("ute", { "ut-belt": { on: true, label: "Belts", critical: true } }, "admin");
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data.items, [{ id: "ut-belt", label: "Belts", critical: true }]);
  assert.equal(itemsFor("ute", [{ id: "ute", items: saved.data.items }]).length, 1);
});

test("a fail needs a comment and a critical fail means do not operate", () => {
  const items = itemsFor("tip-truck", []);
  const answers = Object.fromEntries(items.map(item => [item.id, { result: "pass", comment: "" }]));
  answers["tt-lights"] = { result: "fail", comment: "" };
  assert.equal(prestartPayload({ asset, day: "2026-11-06", reading: "84210", readingUnit: "km", odometer: "", answers, signerName: "Patrick", items }, "patrick").ok, false);
  answers["tt-lights"].comment = "Left indicator out";
  const minor = prestartPayload({ asset, day: "2026-11-06", reading: "84210", readingUnit: "km", odometer: "", answers, signerName: "Patrick", items }, "patrick");
  assert.equal(minor.ok, true);
  assert.equal(minor.data.defect, true);
  assert.equal(minor.data.doNotOperate, false);
  assert.equal(minor.data.kind, "tip-truck");
  assert.equal(minor.data.reading, 84210);
  assert.equal(minor.data.readingUnit, "km");
  assert.equal(prestartPayload({ asset, day: "2026-11-06", reading: "", readingUnit: "km", odometer: "", answers, signerName: "Patrick", items }, "patrick").reason, "Enter the odometer (km).");
  answers["tt-hyd"] = { result: "fail", comment: "Weep at the ram" };
  const built = prestartPayload({ asset, day: "2026-11-06", reading: "84210", readingUnit: "km", odometer: "", answers, signerName: "Patrick", items }, "patrick");
  assert.equal(built.ok, true);
  assert.equal(built.data.doNotOperate, true);
  assert.equal(built.data.resolved, false);
  assert.equal(built.data.signerUid, "patrick");
  assert.equal("photo" in built.data, false);
  const open = openDefects([{ id: "ps1", ...built.data }]);
  assert.equal(open.length, 1);
  assert.equal(stopsOperation(open[0]), true);
  assert.equal(openDefects([{ ...built.data, resolved: true }]).length, 0);
  const trailer = prestartPayload({
    asset: { id: "a2", type: "trailer", name: "Dog trailer" }, day: "2026-11-06", reading: "", readingUnit: "", odometer: "",
    answers: Object.fromEntries(itemsFor("trailer", []).map(item => [item.id, { result: "pass", comment: "" }])),
    signerName: "Patrick", items: itemsFor("trailer", []),
  }, "patrick");
  assert.equal(trailer.ok, true);
  assert.equal(trailer.data.reading, 0);
  assert.equal(trailer.data.readingUnit, "");
  assert.equal(trailer.data.kind, "trailer");
  const missing = missingToday({
    assets: [asset, { id: "a2", name: "Preview trailer" }],
    prestarts: [{ assetId: "a1", day: "2026-11-06", signerUid: "patrick" }],
    jobs: [{ date: "2026-11-06", status: "Scheduled", assigned: ["patrick", "sam"], assignedNames: ["Patrick", "Sam"] }],
    today: "2026-11-06",
  });
  assert.deepEqual(missing.machines.map(item => item.id), ["a2"]);
  assert.deepEqual(missing.missingPeople, ["Sam"]);
  const form = prestartFormHtml({
    assets: [asset, { id: "plant1", type: "plant", prestartKind: "excavator", name: "Excavator", rego: "EX1" }],
    assetId: "plant1", kind: "excavator", items: itemsFor("excavator", []), signerName: "Test Worker", defects: [],
  });
  assert.match(form, /Preview tipper/);
  assert.match(form, /Excavator/);
  assert.match(form, /Walk-around/);
  assert.match(form, /Do not operate/);
  assert.match(form, /Any machine in the fleet/);
  assert.equal(form.includes("assigned to it"), true);
  assert.match(form, /Hour meter \(hrs\)/);
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

test("prestart readings are required by unit and only move Fleet up", async () => {
  const { fleetReadingUpdate, prestartFormHtml: form } = await import("../../app/features/prestart.js");
  const ex = { id: "ex", type: "plant", prestartKind: "excavator", name: "JCB", reading: 1200, readingUnit: "hours" };
  const items = itemsFor("excavator", []);
  const answers = Object.fromEntries(items.map(item => [item.id, { result: "pass", comment: "" }]));
  assert.equal(prestartPayload({ asset: ex, day: "2026-11-08", reading: "", readingUnit: "hours", odometer: "", answers, signerName: "Sam", items }, "sam").reason, "Enter the hour meter (hrs).");
  const ok = prestartPayload({ asset: ex, day: "2026-11-08", reading: "1210", readingUnit: "hours", odometer: "", answers, signerName: "Sam", items }, "sam");
  assert.equal(ok.ok, true);
  assert.deepEqual(fleetReadingUpdate(ex, ok.data, "sam", "Sam").update, { reading: 1210, readingUnit: "hours", readingBy: "sam", readingByName: "Sam" });
  const low = fleetReadingUpdate(ex, { reading: 1100, readingUnit: "hours" }, "sam", "Sam");
  assert.equal(low.update, null);
  assert.match(low.warn, /lower than the last one/);
  assert.equal(fleetReadingUpdate(ex, { reading: 1200, readingUnit: "hours" }, "sam", "Sam").update, null);
  assert.equal(fleetReadingUpdate({ id: "t", type: "trailer" }, { reading: 0, readingUnit: "" }, "sam", "Sam").update, null);
  const html = form({ assets: [ex], assetId: "ex", items, signerName: "Sam", defects: [], kind: "excavator" });
  assert.match(html, /Hour meter \(hrs\)<input name="reading"[^>]*required/);
});
