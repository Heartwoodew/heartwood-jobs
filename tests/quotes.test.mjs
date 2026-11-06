import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calcQuote, resolvePresetId, machineSelectionFromPreset, EQUIPMENT_PRESETS, FLEET_MACHINES,
  sanitizeQuoteRatesWrite, buildAcceptedJob, plantRunSheetLines, quotePrintHtml, roundMoney,
  describeStaff, GST_RATE, DEFAULT_DUAL_MACHINE_SURCHARGE, DEFAULT_SECOND_OPERATOR_RATE
} from "../app/features/quotes.js";

const rates = {
  travelPerKm: 2.5, materialPerUnit: 3, tipPerLoad: 4,
  machineRates: {
    truck: { rate: 100, unit: "hour" },
    skid: { rate: 80, unit: "hour", primaryOperatorRate: 30 },
    excavator: { rate: 140, unit: "hour", primaryOperatorRate: 60 }
  },
  labourerRate: 50,
  hourlyOnSite: 999
};

const quiet = { travelKm: 0, materialQty: 0, tipLoads: 0 };

function line(q, key) { return q.lines.find(l => l.key === key || l.machineId === key); }

test("money rounds half-up to cents", () => {
  assert.equal(roundMoney(100.005), 100.01);
  assert.equal(roundMoney(1.004), 1);
  assert.equal(roundMoney(2.008), 2.01);
});

test("one machine includes one truck and the primary operator, with no dual surcharge and no second operator", () => {
  const q = calcQuote({ hoursOnSite: 2, machines: ["skid"], secondOperator: false, ...quiet }, rates);
  assert.deepEqual(q.machines, ["truck", "skid"]);
  assert.equal(q.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(line(q, "skid").amount, 160);
  assert.equal(line(q, "skid").detail.includes("not added again"), true);
  assert.equal(line(q, "skid").detail.includes("$30.00"), true);
  assert.equal(q.lines.filter(l => l.key === "dual").length, 0);
  assert.equal(q.lines.filter(l => l.key === "second" || l.key === "labourer").length, 0);
  assert.equal(q.lines.filter(l => l.key === "time").length, 0);
  assert.equal(q.totalEx, 360);
  assert.equal(q.gst, 36);
  assert.equal(q.totalInc, 396);
  assert.equal(q.gstRate, GST_RATE);
});

test("both machines bill one truck and a $50 ex GST dual surcharge, not a second truck", () => {
  const one = calcQuote({ hoursOnSite: 2, machines: ["skid"], ...quiet }, rates);
  const both = calcQuote({ hoursOnSite: 2, machines: ["skid", "excavator"], secondOperator: false, ...quiet }, rates);
  assert.equal(both.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(line(both, "truck").amount, line(one, "truck").amount);
  const dual = line(both, "dual");
  assert.equal(dual.amount, DEFAULT_DUAL_MACHINE_SURCHARGE);
  assert.equal(dual.qty, 1);
  assert.equal(dual.unit, "job");
  assert.equal(dual.label.includes("not a second truck"), true);
  assert.equal(both.lines.filter(l => l.key === "second").length, 0);
  assert.equal(line(both, "excavator").amount, 280);
  assert.equal(line(both, "excavator").detail.includes("$60.00"), true);
  assert.equal(both.totalEx, one.totalEx + 280 + 50);
  assert.equal(both.gst, roundMoney(both.totalEx * 0.1));
  assert.equal(both.totalInc, roundMoney(both.totalEx + both.gst));
  assert.equal(both.totalInc, 759);
});

test("a lone truck is not quoted and a duplicate truck id is still one truck", () => {
  const alone = calcQuote({ hoursOnSite: 2, machines: ["truck"], ...quiet, hourlyOnSite: null }, { ...rates, hourlyOnSite: null });
  assert.deepEqual(alone.machines, []);
  assert.equal(alone.lines.filter(l => l.machineId === "truck").length, 0);
  const dup = calcQuote({ hoursOnSite: 2, machines: ["truck", "truck", "skid"], ...quiet }, rates);
  assert.equal(dup.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(resolvePresetId(dup.machines), "skid");
  assert.deepEqual(machineSelectionFromPreset("truck_skid"), ["truck", "skid"]);
});

test("second operator is $100 ex GST per hour only when requested, ignoring the old labourer price", () => {
  const off = calcQuote({ hoursOnSite: 3, machines: ["skid", "excavator"], secondOperator: false, ...quiet }, rates);
  const oneHour = calcQuote({ hoursOnSite: 1, machines: [], secondOperator: true, travelKm: 0, materialQty: 0, tipLoads: 0 }, { ...rates, travelPerKm: null, materialPerUnit: null, tipPerLoad: null });
  const three = calcQuote({ hoursOnSite: 3, machines: ["excavator"], includeLabourer: true, ...quiet }, rates);
  assert.equal(off.lines.some(l => l.key === "second"), false);
  assert.equal(oneHour.lines.find(l => l.key === "second").amount, 100);
  assert.equal(oneHour.lines.some(l => l.key === "time" || l.key === "labourer"), false);
  assert.equal(oneHour.totalEx, 100);
  assert.equal(oneHour.gst, 10);
  assert.equal(oneHour.totalInc, 110);
  assert.equal(three.lines.find(l => l.key === "second").amount, 300);
  assert.equal(three.lines.find(l => l.key === "second").rate, DEFAULT_SECOND_OPERATOR_RATE);
  assert.equal(three.lines.some(l => l.key === "labourer"), false);
  assert.equal(off.totalEx, 1010);
  assert.equal(three.totalEx, 1020);
  assert.equal(three.gst, 102);
  assert.equal(three.totalInc, 1122);
});

test("an admin second-operator rate replaces the $100 default for new quotes only", () => {
  const priced = { ...rates, secondOperatorRate: 125, dualMachineSurcharge: 80 };
  const q = calcQuote({ hoursOnSite: 2, machines: ["skid"], secondOperator: true, ...quiet }, priced);
  assert.equal(q.lines.find(l => l.key === "second").amount, 250);
  assert.equal(q.lines.some(l => l.key === "dual"), false);
  const both = calcQuote({ hoursOnSite: 1, machines: ["skid", "excavator"], ...quiet }, priced);
  assert.equal(both.lines.find(l => l.key === "dual").amount, 80);
  assert.equal(both.lines.some(l => l.key === "second"), false);
});

test("GST is 10% once on the full ex GST subtotal, including travel, materials, tip and the $50", () => {
  const q = calcQuote({
    hoursOnSite: 2, machines: ["skid", "excavator"], secondOperator: true,
    travelKm: 10, materialQty: 2, tipLoads: 1
  }, rates);
  const ex = 2 * 100 + 2 * 80 + 2 * 140 + 50 + 2 * 100 + 10 * 2.5 + 2 * 3 + 1 * 4;
  assert.equal(ex, 925);
  assert.equal(q.totalEx, 925);
  assert.equal(q.gst, 92.5);
  assert.equal(q.totalInc, 1017.5);
  assert.equal(q.totalInc, roundMoney(q.totalEx + q.gst));
  assert.notEqual(q.gst, roundMoney(q.totalInc * 0.1));
});

test("GST rounding is on the subtotal once, not on each line", () => {
  const q = calcQuote({
    hoursOnSite: 0, machines: [], secondOperator: false,
    travelKm: 1, materialQty: 1, tipLoads: 0
  }, { travelPerKm: 10.04, materialPerUnit: 10.04, tipPerLoad: null, hourlyOnSite: null, machineRates: {} });
  assert.equal(q.totalEx, 20.08);
  assert.equal(q.gst, 2.01);
  assert.equal(q.totalInc, 22.09);
  assert.notEqual(q.gst, 2);
});

test("day-rate plant uses days; the second operator still uses on-site hours", () => {
  const dayRates = {
    ...rates,
    machineRates: {
      ...rates.machineRates,
      excavator: { rate: 500, unit: "day", primaryOperatorRate: 60 },
      truck: { rate: 100, unit: "hour" }
    }
  };
  const q = calcQuote({
    hoursOnSite: 8, machineDays: 2, machines: ["excavator"], secondOperator: true, ...quiet
  }, dayRates);
  assert.equal(line(q, "excavator").qty, 2);
  assert.equal(line(q, "excavator").amount, 1000);
  assert.equal(line(q, "truck").qty, 8);
  assert.equal(line(q, "truck").amount, 800);
  assert.equal(line(q, "second").qty, 8);
  assert.equal(line(q, "second").amount, 800);
  assert.equal(q.totalEx, 2600);
  assert.equal(q.gst, 260);
  assert.equal(q.totalInc, 2860);
});

test("a machine that does not need the truck is not charged a truck, and it shares one truck when another machine needs it", () => {
  const custom = {
    ...rates,
    customMachines: [
      { id: "m_roller", name: "Roller", requiresTruck: false },
      { id: "m_tipper", name: "Tipper", requiresTruck: true }
    ],
    machineRates: {
      ...rates.machineRates,
      m_roller: { rate: 70, unit: "hour", primaryOperatorRate: 25 },
      m_tipper: { rate: 90, unit: "hour", primaryOperatorRate: 40 }
    }
  };
  const roller = calcQuote({ hoursOnSite: 2, machines: ["m_roller"], ...quiet }, custom);
  assert.equal(roller.lines.filter(l => l.machineId === "truck").length, 0);
  assert.equal(roller.lines.some(l => l.key === "dual"), false);
  assert.equal(line(roller, "m_roller").amount, 140);
  assert.equal(roller.totalEx, 140);
  const withSkid = calcQuote({ hoursOnSite: 2, machines: ["m_roller", "skid"], ...quiet }, custom);
  assert.equal(withSkid.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(withSkid.lines.some(l => l.key === "dual"), false);
  assert.equal(withSkid.totalEx, 140 + 160 + 200);
  const all = calcQuote({ hoursOnSite: 1, machines: ["m_tipper", "skid", "excavator"], ...quiet }, custom);
  assert.equal(all.lines.filter(l => l.machineId === "truck").length, 1);
  assert.equal(line(all, "dual").amount, 50);
  assert.equal(all.totalEx, 100 + 80 + 140 + 90 + 50);
});

test("missing machine rates leave GST unset and do not invent a price", () => {
  const q = calcQuote({
    hoursOnSite: 4, machines: ["excavator"], secondOperator: true,
    travelKm: 10, materialQty: 2, tipLoads: 1
  }, { machineRates: { truck: { rate: 100, unit: "hour" } }, labourerRate: 50, travelPerKm: null, materialPerUnit: null, tipPerLoad: null });
  assert.equal(q.totalEx, null);
  assert.equal(q.gst, null);
  assert.equal(q.totalInc, null);
  assert.equal(q.complete, false);
  for (const key of ["machine:excavator", "travel", "materials", "rubbish"]) {
    assert.equal(q.missingRates.includes(key), true, key);
  }
  assert.equal(q.missingRates.includes("second"), false);
  assert.equal(line(q, "truck").amount, 400);
  assert.equal(line(q, "second").amount, 400);
});

test("rate writes reject smuggled fields, the old labourer price, zero, and a primary operator charged on top", () => {
  const ok = sanitizeQuoteRatesWrite({
    travelPerKm: 2.5, materialPerUnit: null, tipPerLoad: null,
    machineRates: {
      truck: { rate: 100, unit: "hour", driver: "Patrick" },
      skid: { rate: 80, unit: "hour", primaryOperatorRate: 30 },
      excavator: { rate: 140, unit: "hour" },
      m_roller: { rate: 70, unit: "hour", primaryOperatorRate: 25 }
    },
    customMachines: [{ id: "m_roller", name: "Roller", requiresTruck: false }],
    secondOperatorRate: 100,
    dualMachineSurcharge: 50
  });
  assert.equal(ok.secondOperatorRate, 100);
  assert.equal(ok.machineRates.truck.driver, "Patrick");
  assert.equal(ok.hourlyOnSite, null);
  assert.equal(Object.hasOwn(ok, "labourerRate"), false);
  assert.throws(() => sanitizeQuoteRatesWrite({ ...ok, labourerRate: 50 }), /not allowed/);
  assert.throws(() => sanitizeQuoteRatesWrite({ ...ok, gstRate: 0.2 }), /not allowed|Unexpected/);
  assert.throws(() => sanitizeQuoteRatesWrite({ ...ok, secondOperatorRate: 0 }), /positive/);
  assert.throws(() => sanitizeQuoteRatesWrite({ ...ok, dualMachineSurcharge: -5 }), /positive/);
  assert.throws(() => sanitizeQuoteRatesWrite({
    machineRates: { skid: { rate: 80, unit: "hour", primaryOperatorRate: 90 } },
    customMachines: []
  }), /inside the full setup/);
  assert.throws(() => sanitizeQuoteRatesWrite({
    customMachines: [{ id: "m_roller", name: "Roller", requiresTruck: false, truckRate: 999 }],
    machineRates: { m_roller: { rate: 70, unit: "hour" } }
  }), /Unexpected machine field/);
});

test("accepted quote and job keep the priced snapshot when rates change", () => {
  const inputs = { hoursOnSite: 2, machines: ["skid", "excavator"], secondOperator: true, travelKm: 4, materialQty: 1, tipLoads: 1, description: "Backslab", client: "Orbit", address: "1 Test St" };
  const calc = calcQuote(inputs, rates);
  const snapshot = sanitizeQuoteRatesWrite({
    travelPerKm: rates.travelPerKm,
    materialPerUnit: rates.materialPerUnit,
    tipPerLoad: rates.tipPerLoad,
    machineRates: rates.machineRates,
    customMachines: [],
    secondOperatorRate: DEFAULT_SECOND_OPERATOR_RATE,
    dualMachineSurcharge: DEFAULT_DUAL_MACHINE_SURCHARGE,
    hourlyOnSite: null
  });
  const job = buildAcceptedJob("q9", {
    ...inputs, ...calc, plant: calc.plant, ratesSnapshot: snapshot, yardAddress: rates.yardAddress
  }, { uid: "admin" });
  const later = calcQuote(inputs, {
    ...rates,
    secondOperatorRate: 180,
    dualMachineSurcharge: 75,
    machineRates: { ...rates.machineRates, skid: { rate: 500, unit: "hour" } }
  });
  assert.equal(job.date, "");
  assert.equal(job.quoteStatus, "Accepted");
  assert.equal(job.secondOperator, true);
  assert.deepEqual(job.operators.map(o => o.id), calc.plant.operators.map(o => o.id));
  assert.equal(job.operators.filter(o => o.id === "truck:operator").length, 1);
  assert.equal(job.operators.some(o => o.id === "second:operator"), true);
  assert.equal(job.quote.totalEx, calc.totalEx);
  assert.equal(job.quote.gst, calc.gst);
  assert.equal(job.quote.totalInc, calc.totalInc);
  assert.equal(job.quote.lines.find(l => l.key === "second").rate, 100);
  assert.equal(job.quote.lines.find(l => l.key === "dual").amount, 50);
  assert.notEqual(later.totalInc, job.quote.totalInc);
  assert.equal(/\$/.test(job.description), false);
  assert.equal(/surcharge/i.test(job.description), false);
  assert.equal(job.description.includes("Second operator required"), true);
  assert.equal(job.description.includes("Both the skid steer and excavator are required."), true);
  assert.equal(job.description.includes("not a second truck"), true);
  const staffText = plantRunSheetLines(job).join("\n");
  assert.equal(staffText, describeStaff(calc.plant).join("\n"));
  assert.equal(/\$|\b50\b|\b100\b|\b60\b|surcharge/i.test(staffText), false);
  const html = quotePrintHtml(calc, { client: "Orbit", address: "1 Test St" });
  assert.match(html, /Subtotal ex GST/);
  assert.match(html, /GST 10%/);
  assert.match(html, /Total inc GST/);
  assert.match(html, /not a second truck/);
  assert.equal(html.includes("truck is not billed"), false);
});

test("staff run sheet for both machines has no dollars and no surcharge", () => {
  const inputs = {
    hoursOnSite: 2, machines: ["skid", "excavator"], secondOperator: false,
    travelKm: 0, materialQty: 0, tipLoads: 0,
    description: "Backslab", client: "Orbit", address: "1 Test St"
  };
  const calc = calcQuote(inputs, rates);
  assert.equal(calc.dualMachines, true);
  assert.equal(calc.lines.find(l => l.key === "dual").amount, 50);
  const job = buildAcceptedJob("q-dual", { ...inputs, ...calc, plant: calc.plant }, { uid: "admin" });
  const sheet = plantRunSheetLines(job).join("\n");
  assert.equal(job.date, "");
  assert.equal(job.quoteStatus, "Accepted");
  assert.equal(job.quote.totalEx, calc.totalEx);
  assert.equal(job.quote.gst, calc.gst);
  assert.equal(job.quote.totalInc, calc.totalInc);
  assert.equal(job.quote.lines.find(l => l.key === "dual").amount, 50);
  assert.match(sheet, /Both the skid steer and excavator are required\./);
  assert.equal(/\$/.test(sheet), false);
  assert.equal(/surcharge/i.test(sheet), false);
  assert.equal(/\$/.test(job.description), false);
  assert.equal(/surcharge/i.test(job.description), false);
  assert.match(job.description, /Both the skid steer and excavator are required\./);
});

test("presets and the shell stay in place", () => {
  assert.equal(FLEET_MACHINES.map(m => m.id).join(","), "truck,skid,excavator");
  assert.equal(EQUIPMENT_PRESETS.every(p => p.machines.filter(id => id === "truck").length === 1), true);
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /hw-shell-v52-quote-gst/);
  assert.match(sw, /features\/quotes\.js/);
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /canSeeMoney = \(\) => !!me && \(me\.role === "admin" \|\| me\.role === "supervisor" \|\| me\.staffRole === "supervisor"\)/);
  assert.match(app, /canEditQuoteRates = \(\) => !!\(me && me\.role === "admin"\)/);
  assert.match(app, /plantRunSheetLines/);
  assert.match(app, /id="emailph"/);
  assert.match(app, /data-act="start"/);
});
