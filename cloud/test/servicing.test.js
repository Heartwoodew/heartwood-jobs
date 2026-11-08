import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMembership } from "../../app/features/cloud-storage.js";
import { CALLUP_PLANS, canEditServicing, canViewServicing } from "../../app/features/compliance.js";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";
import {
  costPayload, machineService, planPayload, serviceAttention, servicePayload, serviceViews, servicingHtml,
} from "../../app/features/servicing.js";

const TODAY = "2026-11-06";
const assets = [
  { id: "a1", name: "Preview tipper", type: "vehicle", rego: "PRE001" },
  { id: "a2", name: "Preview trailer", type: "trailer", rego: "PRE002" },
  { id: "a4", name: "Preview excavator", type: "plant", rego: "PRE004" },
];
const records = [
  { id: "s1", assetId: "a1", doneOn: "2026-05-01", reading: 1000, readingUnit: "hours", serviceType: "major", servicedBy: "Chuwar Diesel", notes: "" },
  { id: "s2", assetId: "a2", doneOn: "2026-10-20", reading: 0, readingUnit: "", serviceType: "repair", servicedBy: "On site", notes: "" },
];
const plans = [
  { id: "a1", everyDays: 180, everyReading: 250, readingUnit: "hours", currentReading: 1280 },
  { id: "a2", everyDays: 40, everyReading: 0, readingUnit: "", currentReading: 0 },
  { id: "a4", everyDays: 90, everyReading: 250, readingUnit: "hours", currentReading: 0 },
];

test("servicing is Pro and on for Heartwood only", () => {
  assert.equal(CALLUP_PLANS.base.features.servicing, false);
  assert.equal(CALLUP_PLANS.pro.features.servicing, true);
  const hw = resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam" } });
  const plan = hw.tenantId === "heartwood" ? CALLUP_PLANS.pro : CALLUP_PLANS.base;
  assert.equal(canViewServicing(plan), true);
  assert.equal(canEditServicing(plan, "operator", ""), false);
  assert.equal(canEditServicing(plan, "supervisor", ""), true);
  assert.equal(canEditServicing(plan, "admin", "operator"), true);
  assert.equal(canEditServicing(plan, "operator", "supervisor"), true);
  const other = resolveMembership({ uid: "adm2", profile: { role: "admin", tenantId: "otherco" } });
  assert.equal(canViewServicing(other.tenantId === "heartwood" ? CALLUP_PLANS.pro : CALLUP_PLANS.base), false);
});

test("next service is overdue, due within 30 days, or OK", () => {
  const tipper = machineService(assets[0], records, plans[0], TODAY);
  assert.equal(tipper.k, "overdue");
  assert.equal(tipper.nextDate, "2026-10-28");
  assert.equal(tipper.nextReading, 1250);
  const trailer = machineService(assets[1], records, plans[1], TODAY);
  assert.equal(trailer.k, "due");
  assert.equal(trailer.nextDate, "2026-11-29");
  const missing = machineService(assets[2], records, plans[2], TODAY);
  assert.equal(missing.k, "overdue");
  assert.equal(missing.last, null);
  const views = serviceViews(assets, records, plans, TODAY);
  assert.deepEqual(views.map(v => v.asset.id), ["a4", "a1", "a2"]);
  const attn = serviceAttention(views);
  assert.equal(attn.overdue, 2);
  assert.equal(attn.due, 1);
  const later = machineService(
    { id: "a3", name: "Ute" },
    [{ id: "s3", assetId: "a3", doneOn: "2026-08-01", reading: 0, readingUnit: "", serviceType: "major", servicedBy: "Yard" }],
    { everyDays: 365, everyReading: 0, readingUnit: "", currentReading: 0 },
    TODAY,
  );
  assert.equal(later.k, "ok");
  assert.equal(later.nextDate, "2027-08-01");
});

test("service payloads stay plain and staff html hides the cost", () => {
  const rec = servicePayload({
    assetId: "a1", doneOn: "2026-05-01", reading: "1000", readingUnit: "hours",
    serviceType: "major", servicedBy: " Chuwar Diesel ", notes: "",
  }, "sup1");
  assert.equal(rec.ok, true);
  assert.equal(rec.data.servicedBy, "Chuwar Diesel");
  assert.equal("amount" in rec.data, false);
  assert.equal(servicePayload({ assetId: "a1", doneOn: "", reading: "", readingUnit: "", serviceType: "major", servicedBy: "", notes: "" }, "sup1").ok, false);
  const plan = planPayload({ everyDays: "180", everyReading: "250", readingUnit: "hours", currentReading: "1280" }, "sup1");
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.data.everyDays, 180);
  const cost = costPayload({ amount: "$840" }, "sup1");
  assert.equal(cost.data.amount, "$840");
  assert.equal(costPayload({ amount: "" }, "sup1").data, null);
  const views = serviceViews(assets, records, plans, TODAY);
  const staff = servicingHtml(views, { editable: false, showCost: false, costs: { s1: "$840" } });
  assert.match(staff, /Overdue/);
  assert.match(staff, /Due within 30 days/);
  assert.match(staff, /Chuwar Diesel/);
  assert.doesNotMatch(staff, /\$840|data-comp-edit|data-comp-add/);
  const admin = servicingHtml(views, { editable: true, showCost: true, costs: { s1: "$840" } });
  assert.match(admin, /\$840/);
  assert.match(admin, /data-comp-add="service"/);
  assert.match(admin, /data-comp-edit="interval"/);
});

test("servicing rules are an additive block and do not widen storage", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.servicing.rules", import.meta.url), "utf8");
  const start = emu.indexOf("// BEGIN SERVICING RULES");
  const end = emu.indexOf("// END SERVICING RULES");
  assert.ok(start >= 0 && end > start);
  const slice = emu.slice(start, end + "// END SERVICING RULES".length);
  assert.equal(slice, frag.slice(frag.indexOf("// BEGIN SERVICING RULES"), frag.indexOf("// END SERVICING RULES") + "// END SERVICING RULES".length));
  assert.match(slice, /match \/tenants\/\{tenantId\}\/servicing\/\{recordId\}/);
  assert.match(slice, /match \/tenants\/\{tenantId\}\/servicePlans\/\{assetId\}/);
  assert.match(slice, /match \/tenants\/\{tenantId\}\/serviceCosts\/\{recordId\}/);
  assert.match(slice, /allow read: if svcMember\(tenantId\)/);
  assert.match(slice, /allow read: if svcWriter\(tenantId\)/);
  assert.doesNotMatch(slice, /match \/receipts\/|match \/fleet\/|SCHEDULING_APPROVED/);
  assert.doesNotMatch(readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8"), /servicing|serviceCosts/);
  assert.equal(SCHEDULING_APPROVED, false);
  assert.match(readFileSync(new URL("../../app/features/servicing.js", import.meta.url), "utf8"), /not stored in the app/);
});
