import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcQuote, resolvePresetId, machineSelectionFromPreset, EQUIPMENT_PRESETS, FLEET_MACHINES } from "../app/features/quotes.js";

const rates = {
  travelPerKm: 2, materialPerUnit: 3, tipPerLoad: 4,
  machineRates: {
    truck: { rate: 100, unit: "hour" },
    skid: { rate: 80, unit: "hour" },
    excavator: { rate: 120, unit: "hour" }
  },
  labourerRate: 45, labourerUnit: "hour",
  hourlyOnSite: 999
};

test("each preset charges every machine once and never twice for the truck", () => {
  for (const preset of EQUIPMENT_PRESETS) {
    const ids = machineSelectionFromPreset(preset.id);
    assert.equal(new Set(ids).size, ids.length, preset.id);
    assert.equal(ids.filter(id => id === "truck").length <= 1, true);
    const q = calcQuote({ hoursOnSite: 2, machines: ids, includeLabourer: false, travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
    const truckLines = q.lines.filter(l => l.machineId === "truck");
    assert.equal(truckLines.length, ids.includes("truck") ? 1 : 0, preset.id);
    assert.equal(q.lines.filter(l => l.key === "time").length, 0, "no legacy operator line when plant is selected");
  }
});

test("duplicate truck ids still bill the truck once", () => {
  const q = calcQuote({ hoursOnSite: 2, machines: ["truck", "truck", "skid"], travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  assert.deepEqual(q.machines, ["truck", "skid"]);
  assert.equal(q.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(q.totalEx, 2 * 100 + 2 * 80);
  assert.equal(resolvePresetId(q.machines), "truck_skid");
});

test("optional labourer is a separate line and does not change the truck amount", () => {
  const bare = calcQuote({ hoursOnSite: 3, machines: ["truck"], includeLabourer: false, travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  const withLab = calcQuote({ hoursOnSite: 3, machines: ["truck"], includeLabourer: true, travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  const truck = q => q.lines.find(l => l.machineId === "truck").amount;
  assert.equal(truck(bare), truck(withLab));
  assert.equal(withLab.lines.find(l => l.key === "labourer").amount, 3 * 45);
  assert.equal(withLab.totalEx, bare.totalEx + 135);
});

test("day rates use days, not hours", () => {
  const dayRates = {
    ...rates,
    machineRates: { ...rates.machineRates, excavator: { rate: 500, unit: "day" } },
    labourerUnit: "day", labourerRate: 200
  };
  const q = calcQuote({
    hoursOnSite: 8, machineDays: 2, machines: ["excavator"], includeLabourer: true,
    travelKm: 0, materialQty: 0, tipLoads: 0
  }, dayRates);
  const ex = q.lines.find(l => l.machineId === "excavator");
  assert.equal(ex.qty, 2);
  assert.equal(ex.amount, 1000);
  assert.equal(q.lines.find(l => l.key === "labourer").qty, 2);
  assert.equal(q.totalEx, 1400);
});

test("missing rates leave the total incomplete and invent nothing", () => {
  const q = calcQuote({
    hoursOnSite: 4, machines: ["truck", "excavator"], includeLabourer: true,
    travelKm: 10, materialQty: 2, tipLoads: 1
  }, { machineRates: { truck: { rate: 100, unit: "hour" } }, labourerRate: null, travelPerKm: null, materialPerUnit: null, tipPerLoad: null });
  assert.equal(q.totalEx, null);
  assert.equal(q.complete, false);
  for (const key of ["machine:excavator", "labourer", "travel", "materials", "rubbish"]) {
    assert.equal(q.missingRates.includes(key), true, key);
  }
  assert.equal(q.lines.some(l => l.rate === 0 && l.key !== "machine:truck"), false);
  const truck = q.lines.find(l => l.machineId === "truck");
  assert.equal(truck.amount, 400);
});

test("zero quantities do not demand a rate", () => {
  const q = calcQuote({ hoursOnSite: 1, machines: ["skid"], travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  assert.equal(q.complete, true);
  assert.equal(q.missingRates.length, 0);
  assert.equal(q.totalEx, 80);
});

test("quote module and service worker stay in place", () => {
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v\d+-[a-z]+/);
  assert.match(sw, /org-settings\.js/);
  assert.match(sw, /features\/servicing\.js/);
  assert.match(sw, /features\/leave\.js/);
  assert.match(sw, /features\/prestart\.js/);
  assert.match(sw, /features\/timesheet\.js/);
  assert.match(sw, /features\/claims\.js/);
  assert.match(sw, /features\/hours-export\.js/);
  assert.match(sw, /callup-shell-v74-no-helper/);
  assert.doesNotMatch(sw, /features\/helper/);
  assert.match(sw, /features\/compliance\.js/);
  assert.match(sw, /features\/route-order\.js/);
  assert.match(sw, /features\/swms-sign\.js/);
  assert.match(sw, /route-config\.js/);
  assert.match(sw, /features\/chat-ui\.js/);
  assert.match(sw, /features\/photo-gallery\.js/);
  assert.match(sw, /features\/cloud-storage\.js/);
  assert.match(sw, /features\/quotes\.js/);
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /id="emailph"/);
  assert.match(app, /data-act="start"/);
  assert.match(app, /data-act="done"/);
  assert.match(app, /data-act="note"/);
  assert.match(app, /id="back"/);
  assert.match(app, /canSeeMoney = \(\) => !!me && \(me\.role === "admin" \|\| me\.role === "supervisor" \|\| me\.staffRole === "supervisor"\)/);
  assert.match(app, /canEditQuoteRates = \(\) => !!\(me && me\.role === "admin"\)/);
  assert.equal(FLEET_MACHINES.map(m => m.id).join(","), "truck,skid,excavator");
});
