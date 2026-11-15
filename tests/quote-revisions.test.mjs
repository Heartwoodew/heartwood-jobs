import test from "node:test";
import assert from "node:assert/strict";
import { calcQuote } from "../app/features/quotes.js";
import {
  changeLines, commercialSnapshot, compareHtml, diffRevisions, revisionBody, revisionDocId, revisionNeeded, sameCommercial
} from "../app/features/quote-revisions.js";

const rates = {
  travelPerKm: 2, materialPerUnit: 3, tipPerLoad: 4,
  machineRates: { truck: { rate: 100, unit: "hour" }, skid: { rate: 80, unit: "hour" }, excavator: { rate: 120, unit: "hour" } },
  labourerRate: 45, labourerUnit: "hour"
};

function quote(hours, extra) {
  return calcQuote({ hoursOnSite: hours, machines: ["truck", "skid"], travelKm: 0, materialQty: 0, tipLoads: 0, extraItems: extra || [] }, rates);
}

test("earthworks quote maths is unchanged by revision snapshots", () => {
  const q = quote(2);
  assert.equal(q.totalEx, 2 * 100 + 2 * 80);
  assert.equal(q.lines.filter(l => l.machineId === "truck").length, 1);
});

test("a changed quote diffs lines, quantities, prices and totals", () => {
  const before = quote(2);
  const after = quote(3, [{ id: "x1", kind: "custom", description: "Tip fees", qty: 2, unit: "load", unitPrice: 40, note: "" }]);
  assert.equal(sameCommercial(before, before), true);
  assert.equal(sameCommercial(before, after), false);
  const diff = diffRevisions(before, after);
  const truck = diff.lines.find(row => row.key === "machine:truck");
  assert.equal(truck.change, "changed");
  assert.deepEqual(truck.fields.find(field => field.name === "qty"), { name: "qty", from: 2, to: 3 });
  assert.equal(truck.fields.find(field => field.name === "amount").to, 300);
  assert.equal(diff.lines.some(row => row.change === "added" && row.key === "extra:x1"), true);
  assert.equal(diff.totals.find(row => row.name === "totalEx").from, 360);
  assert.equal(diff.totals.find(row => row.name === "totalEx").to, 620);
  const shown = changeLines(diff, { showMoney: true }).join("\n");
  assert.match(shown, /qty 2 → 3/);
  assert.match(shown, /\$300\.00/);
  assert.match(shown, /totalEx/);
  const hidden = compareHtml(before, after, { showMoney: false });
  assert.match(hidden, /qty 2 → 3/);
  assert.match(hidden, /Added Tip fees/);
  assert.doesNotMatch(hidden, /\$/);
  assert.equal(revisionNeeded({ revisionCount: 1, ...commercialSnapshot(before) }, before), false);
  assert.equal(revisionNeeded({ revisionCount: 1, ...commercialSnapshot(before) }, after), true);
  assert.equal(revisionNeeded({ revisionCount: 0 }, before), true);
});

test("a revision document is numbered and keeps the commercial snapshot", () => {
  const snap = commercialSnapshot(quote(1));
  assert.equal(revisionDocId(1), "r001");
  assert.equal(revisionDocId(12), "r012");
  const body = revisionBody({
    revision: 2, quoteId: "q1", companyId: "heartwood", uid: "u1", name: "Sue",
    atIso: "2026-11-16T01:00:00.000Z", snapshot: snap, changes: ["qty 1 → 2"]
  });
  assert.equal(body.revision, 2);
  assert.equal(body.quoteId, "q1");
  assert.equal(body.companyId, "heartwood");
  assert.equal(body.lines.some(line => line.key === "machine:truck" && line.qty === 1), true);
  assert.equal(body.totalEx, snap.totalEx);
  assert.deepEqual(body.changes, ["qty 1 → 2"]);
});
