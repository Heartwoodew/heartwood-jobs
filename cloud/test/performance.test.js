import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_WEIGHTS, canEditPerformanceSettings, canSeeStaffPerformance, includeInRanking, jobValueEx,
  performancePanelHtml, performanceSettingsHtml, periodBounds, rankPerformance,
} from "../../app/features/performance.js";

const day = "2026-11-15";
const people = [
  { uid: "crew-a", name: "Ada Crew", role: "operator" },
  { uid: "crew-b", name: "Ben Crew", role: "labourer" },
  { uid: "sup", name: "Sue Lead", role: "supervisor" },
  { uid: "mgr", name: "Mo Lead", role: "manager" },
];

function sheet(uid, date, start, finish, job = "") {
  return {
    id: `${uid}_2026-11-09`, uid, companyId: "bravo", weekStart: "2026-11-09",
    entries: { e1: { id: "e1", source: "manual", status: "closed", date, start, finish, job, breakStart: "12:00", breakEnd: "12:30" } },
  };
}

test("period bounds cover the week, month, last 3 months, financial year and custom", () => {
  assert.deepEqual(periodBounds("week", day), { kind: "week", start: "2026-11-09", end: "2026-11-15", label: "This week" });
  assert.deepEqual(periodBounds("month", day).start, "2026-11-01");
  assert.equal(periodBounds("month", day).end, "2026-11-30");
  assert.equal(periodBounds("3months", day).start, "2026-08-15");
  assert.equal(periodBounds("fy", "2026-11-15").start, "2026-07-01");
  assert.equal(periodBounds("fy", "2026-03-01").start, "2025-07-01");
  assert.equal(periodBounds("fy", "2026-03-01").end, "2026-03-01");
  assert.equal(periodBounds("custom", day, { start: "2026-01-02", end: "2026-01-01" }).start, "2026-01-01");
});

test("only managers and admins see performance, and only admins edit the weights", () => {
  assert.equal(canSeeStaffPerformance({ role: "operator" }), false);
  assert.equal(canSeeStaffPerformance({ role: "labourer" }), false);
  assert.equal(canSeeStaffPerformance({ role: "supervisor" }), false);
  assert.equal(canSeeStaffPerformance({ role: "admin", staffRole: "supervisor" }), false);
  assert.equal(canSeeStaffPerformance({ role: "manager" }), true);
  assert.equal(canSeeStaffPerformance({ role: "admin", staffRole: "manager" }), true);
  assert.equal(canSeeStaffPerformance({ role: "admin", staffRole: "operator" }), true);
  assert.equal(canSeeStaffPerformance({ role: "admin", staffRole: "admin" }), true);
  assert.equal(canEditPerformanceSettings({ role: "manager" }), false);
  assert.equal(canEditPerformanceSettings({ role: "admin", staffRole: "manager" }), false);
  assert.equal(canEditPerformanceSettings({ role: "admin", staffRole: "admin" }), true);
  assert.equal(canEditPerformanceSettings({ role: "admin", staffRole: "operator" }), true);
});

test("supervisors and above are left out while the toggle is on", () => {
  assert.equal(includeInRanking(people[0], true), true);
  assert.equal(includeInRanking(people[1], true), true);
  assert.equal(includeInRanking(people[2], true), false);
  assert.equal(includeInRanking(people[3], true), false);
  assert.equal(includeInRanking(people[2], false), true);
  const ranked = rankPerformance({
    people, timesheets: [sheet("sup", "2026-11-10", "06:00", "16:00"), sheet("crew-a", "2026-11-10", "07:00", "15:00")],
    period: periodBounds("week", day), excludeLeaders: true, sources: { timesheets: "ok" },
  });
  assert.deepEqual(ranked.rows.map(row => row.uid), ["crew-a", "crew-b"]);
  assert.equal(ranked.rows.some(row => row.role === "supervisor"), false);
  const everyone = rankPerformance({
    people, timesheets: [sheet("sup", "2026-11-10", "06:00", "16:00"), sheet("crew-a", "2026-11-10", "07:00", "15:00")],
    period: periodBounds("week", day), excludeLeaders: false, sources: { timesheets: "ok" },
  });
  assert.equal(everyone.rows[0].uid, "sup");
  assert.equal(everyone.rows.some(row => row.uid === "crew-a"), true);
});

test("money is split by hours on the job, otherwise evenly, and incidents and sick days lower the rank", () => {
  assert.deepEqual(jobValueEx({ invoiceAmount: 10, poAmount: 20, quoteAmount: 30 }), { amount: 10, basis: "invoice" });
  assert.equal(jobValueEx({ poAmount: 20, quoteAmount: 30 }).basis, "PO");
  assert.equal(jobValueEx({ quoteAmount: 30 }).basis, "quote");
  const jobs = [{
    id: "job-1", sm8JobNo: "441", status: "Done", date: "2026-11-10",
    assigned: ["crew-a", "crew-b"], invoiceAmount: 300,
  }];
  const even = rankPerformance({
    people, jobs, period: periodBounds("week", day), excludeLeaders: true,
    timesheets: [sheet("crew-a", "2026-11-10", "07:00", "15:00"), sheet("crew-b", "2026-11-10", "07:00", "15:00")],
    sources: { timesheets: "ok" },
  });
  const ada = even.rows.find(row => row.uid === "crew-a");
  const ben = even.rows.find(row => row.uid === "crew-b");
  assert.equal(ada.money, 150);
  assert.equal(ben.money, 150);
  assert.equal(ada.jobsDetail[0].method, "even");
  const byHours = rankPerformance({
    people, jobs, period: periodBounds("week", day), excludeLeaders: true,
    timesheets: [sheet("crew-a", "2026-11-10", "07:00", "15:00", "441"), sheet("crew-b", "2026-11-10", "07:00", "11:00", "#441")],
    sources: { timesheets: "ok" },
  });
  const adaH = byHours.rows.find(row => row.uid === "crew-a");
  const benH = byHours.rows.find(row => row.uid === "crew-b");
  assert.equal(adaH.jobsDetail[0].method, "hours");
  assert.ok(adaH.money > benH.money);
  const penalised = rankPerformance({
    people: people.slice(0, 2),
    jobs, period: periodBounds("week", day),
    timesheets: [sheet("crew-a", "2026-11-10", "07:00", "15:00"), sheet("crew-b", "2026-11-10", "07:00", "15:00")],
    incidents: [{ occurredAt: "2026-11-10T09:00", staffInvolved: ["crew-b"], people: "" }],
    leaves: [{ uid: "crew-b", name: "Ben Crew", type: "sick", status: "approved", start: "2026-11-12", end: "2026-11-12", startHalf: "", endHalf: "" }],
    sources: { timesheets: "ok", incidents: "ok", leave: "ok" },
  });
  assert.equal(penalised.rows[0].uid, "crew-a");
  assert.equal(penalised.rows.find(row => row.uid === "crew-b").incidents, 1);
  assert.equal(penalised.rows.find(row => row.uid === "crew-b").sick, 1);
});

test("annual leave is neutral unless its weight is raised, and a missing leave feed shows a dash", () => {
  const base = {
    people: people.slice(0, 2),
    period: periodBounds("week", day),
    timesheets: [sheet("crew-a", "2026-11-10", "07:00", "15:00"), sheet("crew-b", "2026-11-10", "07:00", "15:00")],
    leaves: [{ uid: "crew-b", name: "Ben Crew", type: "annual", status: "approved", start: "2026-11-11", end: "2026-11-12", startHalf: "", endHalf: "" }],
    sources: { timesheets: "ok", leave: "ok" },
    weights: DEFAULT_WEIGHTS,
  };
  const neutral = rankPerformance(base);
  assert.equal(neutral.rows[0].score, neutral.rows[1].score);
  assert.equal(neutral.rows.find(row => row.uid === "crew-b").annual, 2);
  const weighted = rankPerformance({ ...base, weights: { ...DEFAULT_WEIGHTS, annual: 1 } });
  assert.equal(weighted.rows[0].uid, "crew-a");
  const missing = rankPerformance({ ...base, sources: { timesheets: "ok", leave: "absent" } });
  const html = performancePanelHtml(missing, { periodKind: "week" });
  assert.match(html, /–/);
  assert.equal(missing.rows.find(row => row.uid === "crew-b").annual, 0);
  assert.match(html, /\$150\.00|\$0\.00/);
});

test("Take 5 completion changes the score only while the setting is on", () => {
  const shared = {
    people: people.slice(0, 2),
    period: periodBounds("week", day),
    timesheets: [sheet("crew-a", "2026-11-10", "07:00", "15:00"), sheet("crew-b", "2026-11-10", "07:00", "15:00")],
    jobs: [
      { id: "job-a", status: "Done", date: "2026-11-10", assigned: ["crew-a"], invoiceAmount: 100 },
      { id: "job-b", status: "Done", date: "2026-11-10", assigned: ["crew-b"], invoiceAmount: 100 },
    ],
    take5s: [{ id: "t1", uid: "crew-a", jobId: "job-a" }],
    sources: { timesheets: "ok", take5: "ok" },
  };
  const off = rankPerformance({ ...shared, take5On: false });
  assert.equal(off.rows[0].score, off.rows[1].score);
  assert.equal(off.take5On, false);
  const on = rankPerformance({ ...shared, take5On: true });
  const unset = rankPerformance(shared);
  assert.equal(unset.take5On, true);
  assert.equal(unset.rows[0].uid, on.rows[0].uid);
  assert.equal(unset.rows[0].score, on.rows[0].score);
  assert.equal(on.rows[0].uid, "crew-a");
  assert.equal(on.rows.find(row => row.uid === "crew-a").take5, 1);
  assert.equal(on.rows.find(row => row.uid === "crew-b").take5, 0);
  const html = performancePanelHtml(on, { periodKind: "week" });
  assert.match(html, /Take 5/);
  assert.match(html, /Remove supervisors and above/);
  assert.match(html, /checked/);
  const offHtml = performancePanelHtml(off, { periodKind: "week" });
  assert.doesNotMatch(offHtml, /<th>Take 5<\/th>/);
  assert.match(performanceSettingsHtml(), /name="enabled" type="checkbox" checked/);
  assert.match(performanceSettingsHtml(), /start on for every company/);
  assert.doesNotMatch(performanceSettingsHtml({}, { take5On: false }), /checkbox" checked/);
});

test("prestart completion is signed days divided by days worked", () => {
  const ranked = rankPerformance({
    people: [people[0]],
    period: periodBounds("week", day),
    timesheets: [{
      id: "crew-a_2026-11-09", uid: "crew-a",
      entries: {
        a: { id: "a", source: "manual", status: "closed", date: "2026-11-10", start: "07:00", finish: "15:00", breakStart: "12:00", breakEnd: "12:30" },
        b: { id: "b", source: "manual", status: "closed", date: "2026-11-11", start: "07:00", finish: "15:00", breakStart: "12:00", breakEnd: "12:30" },
      },
    }],
    prestarts: [{ signerUid: "crew-a", day: "2026-11-10" }],
    sources: { timesheets: "ok", prestarts: "ok" },
  });
  assert.equal(ranked.rows[0].prestart, 0.5);
  assert.equal(ranked.rows[0].hours > 0, true);
});

test("an old incident counts the named staff, and the staff page hides the panel from crew", () => {
  const ranked = rankPerformance({
    people: people.slice(0, 2),
    period: periodBounds("month", day),
    incidents: [{ occurredAt: "2026-11-02T08:00", people: "Ben Crew, visitor" }],
    sources: { incidents: "ok" },
  });
  assert.equal(ranked.rows.find(row => row.uid === "crew-b").incidents, 1);
  assert.equal(ranked.rows.find(row => row.uid === "crew-a").incidents, 0);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /canSeeStaffPerformance\(me\) \? performancePanelHtml/);
  assert.match(app, /openTake5\(j, \(\) => startJobDoc\(j\)\)/);
  assert.doesNotMatch(app, /performancePanelHtml\([\s\S]{0,80}crew/);
});
