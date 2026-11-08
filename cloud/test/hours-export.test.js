import test from "node:test";
import assert from "node:assert";
import * as m from "../../app/features/hours-export.js";

test("hours xlsx: summary + detail, subtotals, no ids, valid zip", async () => {
  const rep = m.buildHoursReport({ weekStart: "2026-11-02", people: [{ uid: "u1", name: "Sam" }, { uid: "u2", name: "Al" }],
    sheets: [{ uid: "u1", entries: { e1: { id: "e1", date: "2026-11-03", start: "06:00", finish: "14:30", source: "manual", job: "J1" } } }],
    leaveText: (p, d) => (p.uid === "u2" && d === "2026-11-05" ? "Sick leave" : "") });
  assert.equal(rep.total, 8);
  assert.deepEqual(rep.people.map(p => [p.name, p.total, p.leave.length]), [["Al", 0, 1], ["Sam", 8, 0]]);
  const sheets = m.reportSheets(rep, { company: "Heartwood", generated: new Date("2026-11-08T06:00:00Z") });
  assert.deepEqual(sheets.map(s => s.name), ["Summary", "Detail"]);
  assert.match(sheets[1].xml, /Sam total/);
  assert.match(sheets[0].xml, /Grand total/);
  assert.doesNotMatch(sheets[1].xml, /u1|e1/);
  const b = m.xlsxBytes(sheets);
  assert.equal(b[0], 0x50); assert.equal(b[1], 0x4b);
  assert.equal(m.exportFileName("Heartwood Earthworks", "2026-11-02"), "Heartwood_Earthworks_hours_2026-11-02_to_2026-11-08.xlsx");
  assert.match(m.newExportId(), /^hx[a-z0-9]{16}$/);
  assert.equal(m.ACCOUNTS_TO, "accounts@heartwoodew.com");
});
