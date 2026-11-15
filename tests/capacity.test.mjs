import test from "node:test";
import assert from "node:assert/strict";
import { brisbaneYmd, mondayOf, shiftWeek, jobDates, suburbOf, buildCapacity, capacityViewHtml } from "../app/features/capacity.js";

const cover = { from: "2026-11-16", to: "2026-11-22" };
const sam = { uid: "u1", name: "Sam", companyId: "heartwood" };
const alex = { uid: "u2", name: "Alex", companyId: "heartwood" };

test("weeks are Monday to Sunday in Australia/Brisbane", () => {
  assert.equal(brisbaneYmd(new Date("2026-11-15T14:30:00Z")), "2026-11-16");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(brisbaneYmd(new Date("2026-11-15T13:30:00Z")), "2026-11-15");
  assert.equal(mondayOf(new Date("2026-11-15T13:30:00Z")), "2026-11-09");
  assert.equal(shiftWeek("2026-11-18", 0), "2026-11-16");
  assert.equal(shiftWeek("2026-11-18", 1), "2026-11-23");
  assert.equal(shiftWeek("2026-11-18", -1), "2026-11-09");
});

test("a job occupies its date, an end date, and a Brisbane overnight finish", () => {
  assert.deepEqual(jobDates({ date: "2026-11-16", time: "07:00", durationHrs: 8, status: "Scheduled" }), ["2026-11-16"]);
  assert.deepEqual(jobDates({ date: "2026-11-16", endDate: "2026-11-18", status: "Scheduled" }), ["2026-11-16", "2026-11-17", "2026-11-18"]);
  assert.deepEqual(jobDates({ date: "2026-11-16", time: "20:00", durationHrs: 6, status: "Scheduled" }), ["2026-11-16", "2026-11-17"]);
  assert.deepEqual(jobDates({ date: "", status: "Scheduled" }), []);
  assert.deepEqual(jobDates({ date: "2026-11-16", status: "Cancelled", durationHrs: 30 }), []);
  assert.deepEqual(jobDates({ date: "2026-11-16", sm8Status: "Unsuccessful" }), []);
});

test("capacity uses jobs and approved leave, not another company, and hides prices", () => {
  const jobs = [
    { id: "a", companyId: "heartwood", date: "2026-11-16", endDate: "2026-11-18", status: "Scheduled", assigned: ["u1"], assignedNames: ["Sam"], address: "12 Smith St, Chuwar QLD 4306", description: "Spoil $500" },
    { id: "b", companyId: "heartwood", date: "2026-11-16", time: "07:00", durationHrs: 4, status: "Scheduled", assigned: ["u2"], assignedNames: ["Alex"], address: "1 Oak Ave, Springfield Lakes QLD 4300" },
    { id: "c", companyId: "heartwood", date: "2026-11-16", time: "13:00", durationHrs: 2, status: "Done", assigned: ["u2"], assignedNames: ["Alex"], address: "9 Creek Rd, Chuwar QLD 4306" },
    { id: "other", companyId: "bravo", date: "2026-11-16", status: "Scheduled", assigned: ["u1"], assignedNames: ["Sam"], address: "9 Other St, Ipswich QLD 4305" },
    { id: "off", companyId: "heartwood", date: "2026-11-16", status: "Cancelled", assigned: ["u2"], assignedNames: ["Alex"], address: "1 Gone St, Ripley QLD 4306" }
  ];
  const leaves = [
    { uid: "u1", name: "Sam", companyId: "heartwood", status: "approved", type: "annual", start: "2026-11-17", end: "2026-11-17", startHalf: "am", endHalf: "am" },
    { uid: "u9", name: "Pat", companyId: "bravo", status: "approved", type: "sick", start: "2026-11-16", end: "2026-11-16", startHalf: "", endHalf: "" }
  ];
  const model = buildCapacity({ people: [sam, alex], jobs, leaves, weekStart: "2026-11-16", companyId: "heartwood", coverage: cover });
  assert.deepEqual(model.days, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  const row = name => model.rows.find(r => r.person.name === name);
  const samMon = row("Sam").cells[0];
  const samTue = row("Sam").cells[1];
  const samWed = row("Sam").cells[2];
  const samThu = row("Sam").cells[3];
  assert.equal(samMon.state, "booked");
  assert.equal(samMon.jobCount, 1);
  assert.deepEqual(samMon.suburbs, ["Chuwar"]);
  assert.equal(samTue.state, "leave");
  assert.match(samTue.detail, /morning only/);
  assert.match(samTue.detail, /also 1 job/);
  assert.equal(samWed.state, "booked");
  assert.equal(samThu.state, "free");
  const alexMon = row("Alex").cells[0];
  assert.equal(alexMon.state, "booked");
  assert.equal(alexMon.jobCount, 2);
  assert.deepEqual(alexMon.suburbs, ["Springfield Lakes", "Chuwar"]);
  assert.equal(model.rows.some(r => r.person.name === "Pat"), false);
  const html = capacityViewHtml({ people: [sam, alex], jobs, leaves, weekStart: "2026-11-16", companyId: "heartwood", coverage: cover, today: "2026-11-16" });
  assert.match(html, /Booked/);
  assert.match(html, /On leave/);
  assert.match(html, /Free/);
  assert.match(html, /Chuwar/);
  assert.doesNotMatch(html, /\$|500|Ipswich|Ripley/);
});

test("a day outside the cached job window is not called free", () => {
  const model = buildCapacity({
    people: [sam], jobs: [], leaves: [], weekStart: "2026-11-09", companyId: "heartwood", coverage: cover
  });
  assert.equal(model.rows[0].cells.every(cell => cell.state === "unknown"), true);
  assert.equal(suburbOf("Lot 4, Pay $500, Springfield Lakes QLD 4300"), "Springfield Lakes");
});
