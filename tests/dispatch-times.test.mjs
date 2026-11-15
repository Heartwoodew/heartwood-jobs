import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_JOB_HOURS, DEFAULT_DAY_START, DEFAULT_DAY_END, PAST_FINISH_LABEL, DISPATCH_CATEGORIES,
  brisbaneWallClock, categoryOf, clampJobHours, clockedHoursForJob, defaultDurations,
  dispatchSettingsHtml, estimateDuration, formatEstimate, historyMedians, isManualStart,
  normaliseTime, planAutoTimes, quoteHours, roundTo15, sanitizeDispatchSettings, spaceDay,
  straightKm, travelGapMinutes, withSortHint,
} from "../app/features/dispatch-times.js";

const day = "2026-11-16";
const settings = { dayStart: "07:00", travelGapMin: 30, durations: defaultDurations() };
const job = (id, extra = {}) => ({ id, date: day, time: "07:00", status: "Scheduled", type: "spoil", assigned: ["p"], ...extra });

test("quote hours beat history and the default table, and anything under 1 hour becomes 1", () => {
  assert.equal(MIN_JOB_HOURS, 1);
  assert.equal(quoteHours({ quote: { hoursOnSite: 2.5 } }), 2.5);
  assert.equal(quoteHours({ quote: { hoursOnSite: 0 } }), null);
  assert.equal(quoteHours({ quote: { machineDays: 1 } }), null);
  assert.equal(quoteHours({ durationHrs: 4 }), null);

  const history = { spoil: 4 };
  const fromQuote = estimateDuration(job("a", { quote: { hoursOnSite: 2.5 } }), { history, durations: defaultDurations() });
  assert.equal(fromQuote.source, "quote");
  assert.equal(fromQuote.hours, 2.5);
  assert.equal(formatEstimate(fromQuote.hours), "~2.5 h, est.");

  const shortQuote = estimateDuration(job("b", { quote: { hoursOnSite: 0.25 } }), { history, durations: defaultDurations() });
  assert.equal(shortQuote.source, "quote");
  assert.equal(shortQuote.hours, 1);
  assert.equal(formatEstimate(0.2), "~1 h, est.");
  assert.equal(formatEstimate(1), "~1 h, est.");

  const fromHistory = estimateDuration(job("c"), { history, durations: defaultDurations() });
  assert.equal(fromHistory.source, "history");
  assert.equal(fromHistory.hours, 4);

  const tinyHistory = estimateDuration(job("d"), { history: { spoil: 0.4 }, durations: defaultDurations() });
  assert.equal(tinyHistory.source, "history");
  assert.equal(tinyHistory.hours, 1);

  const fallback = estimateDuration(job("e", { type: "spoil" }), { history: {}, durations: defaultDurations() });
  assert.equal(fallback.source, "default");
  assert.equal(fallback.hours, 2.5);
});

test("job type and description pick the default, and the editor cannot save under 1 hour", () => {
  assert.equal(categoryOf({ type: "spoil", description: "Spoil removal" }), "spoil");
  assert.equal(categoryOf({ type: "backslab", description: "Slab clean and backblade" }), "backslab");
  assert.equal(categoryOf({ type: "other", description: "Roof clean" }), "roof-clean");
  assert.equal(categoryOf({ type: "clean", description: "Scaffold clean" }), "scaffold-clean");
  assert.equal(categoryOf({ type: "clean", description: "Final clean" }), "final-clean");
  assert.equal(categoryOf({ type: "clean", description: "Site clean" }), "site-clean");
  assert.equal(categoryOf({ type: "waterproof" }), "waterproof");
  assert.equal(estimateDuration({ type: "other", description: "Roof clean" }, { durations: defaultDurations() }).hours, 2);
  assert.equal(estimateDuration({ type: "clean", description: "Scaffold clean" }, { durations: defaultDurations() }).hours, 1.5);

  const saved = sanitizeDispatchSettings({
    dayStart: "6:30",
    travelGapMin: 45,
    durations: { spoil: 0.25, "roof-clean": 1, "not-a-type": 9 },
  });
  assert.equal(saved.dayStart, "06:30");
  assert.equal(saved.dayEnd, DEFAULT_DAY_END);
  assert.equal(DEFAULT_DAY_END, "17:00");
  assert.equal(saved.travelGapMin, 45);
  assert.equal(saved.durations.spoil, 1);
  assert.equal(saved.durations["roof-clean"], 1);
  assert.equal(saved.durations.other, defaultDurations().other);
  assert.equal("not-a-type" in saved.durations, false);
  assert.equal(clampJobHours(0), 1);
  assert.equal(clampJobHours(-3), 1);
  for (const cat of DISPATCH_CATEGORIES) assert.ok(cat.hours >= 1);

  const html = dispatchSettingsHtml(saved, { canEdit: true });
  assert.match(html, /min="1"/);
  assert.match(html, /name="dayEnd"/);
  assert.match(html, /name="dur_spoil"/);
  assert.match(html, /name="dur_roof-clean"/);
  assert.doesNotMatch(html, /\$/);
  assert.match(html, /does not change timesheets/i);
});

test("clocked median uses timesheet-on-job rows, then start and finish stamps, and does not change the timesheet", () => {
  const entry = {
    id: "e1", jobId: "done1", source: "clock", status: "closed", date: "2026-11-01",
    start: "07:00", finish: "10:00", breakStart: "12:00", breakEnd: "12:00",
  };
  const before = JSON.stringify(entry);
  const done = {
    id: "done1", status: "Done", type: "spoil", date: "2026-11-01",
    startedAt: "2026-11-01T21:00:00.000Z", completedAt: "2026-11-02T04:00:00.000Z",
  };
  assert.equal(clockedHoursForJob(done, [entry]), 3);
  assert.equal(JSON.stringify(entry), before);
  const other = { id: "done2", status: "Done", type: "spoil", date: "2026-11-02", startedAt: "2026-11-02T21:00:00.000Z", completedAt: "2026-11-02T23:00:00.000Z" };
  const typedOnly = { id: "done3", status: "Done", type: "spoil", durationHrs: 8 };
  const med = historyMedians([done, other, typedOnly], [entry]);
  assert.equal(med.spoil, 2.5);
  assert.equal(historyMedians([typedOnly], []).spoil, undefined);
  assert.equal(JSON.stringify(entry), before);
});

test("auto jobs are spaced from the day start, rounded to 15 minutes, and a pinned time stays", () => {
  const plan = spaceDay([
    job("a"),
    job("b", { time: "07:08", timeSource: "manual" }),
    job("c"),
  ], { ordered: true, settings: { ...settings, durations: { ...defaultDurations(), spoil: 1 } } });
  // 07:08 is only eight minutes after the day start, so the 1 h job cannot sit in front of it.
  assert.equal(plan[0].time, "08:45");
  assert.equal(plan[0].fixed, false);
  assert.equal(plan[0].estLabel, "~1 h, est.");
  assert.equal(plan[1].time, "07:08");
  assert.equal(plan[1].fixed, true);
  assert.equal(plan[2].time, "10:15");

  const early = spaceDay([job("a")], { settings: { ...settings, dayStart: "07:10" } });
  assert.equal(early[0].time, "07:15");

  const legacy = spaceDay([
    job("keep", { time: "08:30" }),
    job("move"),
  ], { ordered: true, settings });
  assert.equal(isManualStart(legacy && { time: "08:30" }), true);
  assert.equal(legacy[0].time, "08:30");
  assert.equal(legacy[0].fixed, true);
  assert.equal(normaliseTime("7:00"), DEFAULT_DAY_START);
});

test("an approved run sheet sets the order, and a drag hint only moves auto jobs", () => {
  const rows = [job("a", { time: "09:00" }), job("b", { time: "07:00" }), job("c", { time: "07:00" })];
  const sheet = { status: "approved", jobIds: ["c", "b", "a"] };
  const plan = spaceDay(rows, { settings: { ...settings, durations: { ...defaultDurations(), spoil: 1 } }, sheet });
  assert.deepEqual(plan.map(p => p.id), ["c", "b", "a"]);
  assert.equal(plan[0].time, "07:00");
  assert.equal(plan[1].time, "10:30");
  assert.equal(plan[2].time, "09:00");
  assert.equal(plan[2].fixed, true);

  const hinted = withSortHint([job("a"), job("b", { time: "11:00", timeSource: "manual" })], "a", 10);
  assert.equal(hinted[0].time, "10:00");
  assert.equal(hinted[1].time, "11:00");
  const spaced = spaceDay(hinted, { settings: { ...settings, durations: { ...defaultDurations(), spoil: 1 } } });
  assert.equal(spaced.find(p => p.id === "b").time, "11:00");
  assert.equal(spaced.find(p => p.id === "a").fixed, false);
});

test("travel gap is straight-line distance at 40 km/h, else the company gap", () => {
  const a = job("a", { geo: { lat: -27.5, lng: 153, query: "1 First St" }, address: "1 First St" });
  const b = job("b", { geo: { lat: -27.5, lng: 153.2, query: "2 Second St" }, address: "2 Second St" });
  const km = straightKm(a.geo, b.geo);
  const gap = travelGapMinutes(a, b, 30);
  assert.equal(gap % 15, 0);
  assert.equal(gap, roundTo15((km / 40) * 60));
  assert.ok(gap >= 15);
  assert.equal(travelGapMinutes(job("x"), job("y"), 45), 45);
  assert.equal(travelGapMinutes(a, { ...a, id: "same" }, 30), 0);
  const stale = { ...b, geo: { ...b.geo, query: "old address" } };
  assert.equal(travelGapMinutes(a, stale, 30), 30);

  const spaced = spaceDay([a, b], {
    ordered: true,
    settings: { ...settings, durations: { ...defaultDurations(), spoil: 1 }, travelGapMin: 30 },
  });
  assert.equal(spaced[0].time, "07:00");
  const start = 7 * 60 + 60 + gap;
  assert.equal(spaced[1].time, `${String(Math.floor(roundTo15(start) / 60)).padStart(2, "0")}:${String(roundTo15(start) % 60).padStart(2, "0")}`);
});

test("start times are Brisbane wall-clock labels and do not follow the host zone", () => {
  assert.equal(brisbaneWallClock("2026-11-14T21:00:00.000Z"), "07:00");
  assert.equal(brisbaneWallClock("2026-11-14T21:00:00.000Z", "UTC"), "21:00");
  assert.equal(brisbaneWallClock("2026-01-15T21:07:00.000Z"), "07:07");
  const plan = spaceDay([
    job("a", { type: "spoil" }),
    job("b", { type: "spoil" }),
  ], { ordered: true, settings });
  assert.equal(plan[0].time, "07:00");
  assert.equal(plan[0].time, brisbaneWallClock("2026-11-14T21:00:00.000Z"));
  assert.equal(plan[1].time, "10:00");
  assert.equal(plan[1].estHours, 2.5);
});

test("only auto times are written, finished and manual jobs are kept, and timesheets are not part of the write", () => {
  const rows = [
    job("auto"),
    job("pinned", { time: "09:15" }),
    job("done", { status: "Done", time: "07:00" }),
    job("otherday", { date: "2026-11-17" }),
  ];
  const writes = planAutoTimes(rows, { settings });
  assert.deepEqual(writes.map(w => w.id), ["auto", "otherday"]);
  assert.equal(writes[0].timeSource, "auto");
  assert.equal(writes[0].time, "12:15");
  assert.ok(writes[0].estHours >= 1);
  assert.equal(writes[0].durationHrs, undefined);
  assert.equal(JSON.stringify(writes).includes("timesheet"), false);

  const applied = rows.map(row => {
    const hit = writes.find(w => w.id === row.id);
    return hit ? { ...row, ...hit } : row;
  });
  assert.deepEqual(planAutoTimes(applied, { settings }), []);

  const sheet = { status: "approved", jobIds: ["b", "a"] };
  const ordered = planAutoTimes([
    job("a", { time: "07:00" }),
    job("b", { time: "07:00" }),
  ], { settings: { ...settings, durations: { ...defaultDurations(), spoil: 1 } }, sheets: { ["p_" + day]: sheet } });
  assert.equal(ordered.find(w => w.id === "b").time, "07:00");
  assert.equal(ordered.find(w => w.id === "a").time, "08:30");
});

test("hand-set jobs reserve their window and a second pass does not move anyone", () => {
  const manual = job("m", { time: "10:00", timeSource: "manual", quote: { hoursOnSite: 2 } });
  const short = job("short", { time: "09:30", timeSource: "auto", quote: { hoursOnSite: 1 } });
  const long = job("long", { time: "11:00", timeSource: "auto", quote: { hoursOnSite: 3 } });
  const first = spaceDay([short, manual, long], { ordered: true, settings });
  const byId = Object.fromEntries(first.map(row => [row.id, row]));
  assert.equal(byId.m.time, "10:00");
  assert.equal(byId.m.fixed, true);
  assert.equal(byId.short.time, "07:00");
  assert.equal(byId.long.time, "12:30");
  const overlaps = (start, hours, blockStart, blockHours) => {
    const a = start.split(":").map(Number);
    const b = blockStart.split(":").map(Number);
    const a0 = a[0] * 60 + a[1];
    const b0 = b[0] * 60 + b[1];
    return a0 < b0 + blockHours * 60 && b0 < a0 + hours * 60;
  };
  assert.equal(overlaps(byId.short.time, 1, "10:00", 2), false);
  assert.equal(overlaps(byId.long.time, 3, "10:00", 2), false);
  const saved = [short, manual, long].map(row => {
    const hit = byId[row.id];
    return { ...row, time: hit.time, timeSource: hit.fixed ? "manual" : "auto", estHours: hit.estHours, estSource: hit.estSource };
  });
  const again = spaceDay(saved, { settings });
  const third = spaceDay(saved.map(row => {
    const hit = again.find(item => item.id === row.id);
    return { ...row, time: hit.time, timeSource: hit.fixed ? row.timeSource : "auto" };
  }), { settings });
  assert.deepEqual(third.map(row => row.time), again.map(row => row.time));
  assert.equal(again.find(row => row.id === "m").time, "10:00");
  assert.equal(again.find(row => row.id === "short").time, "07:00");
  assert.equal(again.find(row => row.id === "long").time, "12:30");
});

test("a short job fills the morning before a hand-set job, in either order", () => {
  const manual = job("hand", { time: "10:00", timeSource: "manual", quote: { hoursOnSite: 2 } });
  const hours = { a1: 1, a3: 3, a21: 2.1, a2: 2 };
  const auto = id => job(id, { time: "07:00", timeSource: "auto", quote: { hoursOnSite: hours[id] } });
  for (const order of [["a3", "a1", "a21", "a2"], ["a1", "a3", "a21", "a2"]]) {
    const rows = [manual, ...order.map(auto)];
    const plan = spaceDay(rows, { ordered: true, settings });
    const byId = Object.fromEntries(plan.map(row => [row.id, row]));
    assert.equal(byId.hand.time, "10:00");
    assert.equal(byId.hand.fixed, true);
    assert.equal(byId.hand.pastFinish, false);
    assert.equal(byId.a1.time, "07:00");
    assert.equal(byId.a1.pastFinish, false);
    assert.equal(byId.a3.time, "12:30");
    assert.equal(byId.a3.pastFinish, false);
    assert.equal(byId.a21.time, "16:00");
    assert.equal(byId.a21.pastFinish, true);
    assert.equal(byId.a2.time, "18:45");
    assert.equal(byId.a2.pastFinish, true);
    assert.ok(plan.some(row => !row.fixed && row.time < "10:00"));
    const saved = rows.map(row => {
      const hit = byId[row.id];
      return { ...row, time: hit.time, timeSource: hit.fixed ? "manual" : "auto", estHours: hit.estHours, estSource: hit.estSource };
    });
    const again = spaceDay(saved, { settings });
    const againById = Object.fromEntries(again.map(row => [row.id, row]));
    for (const id of Object.keys(byId)) {
      assert.equal(againById[id].time, byId[id].time, order.join(",") + " " + id);
      assert.equal(againById[id].pastFinish, byId[id].pastFinish, id);
    }
    const third = spaceDay(saved.map(row => {
      const hit = againById[row.id];
      return { ...row, time: hit.time, timeSource: hit.fixed ? row.timeSource : "auto" };
    }), { settings });
    assert.deepEqual(third.map(row => [row.id, row.time, row.pastFinish]), again.map(row => [row.id, row.time, row.pastFinish]));
  }
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, new RegExp(PAST_FINISH_LABEL));
});

test("dispatch settings rules keep a 1 hour minimum and do not touch timesheets", () => {
  const rules = readFileSync(new URL("../cloud/firestore.production.rules", import.meta.url), "utf8");
  assert.match(rules, /_dispatch/);
  assert.match(rules, /function dispatchDurOk/);
  assert.match(rules, /m\[k\] >= 1/);
  assert.match(rules, /dispatchMetaOk/);
  assert.match(rules, /dayEnd/);
});

test("the board, service worker and timesheet module stay in their lanes", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  const src = readFileSync(new URL("../app/features/dispatch-times.js", import.meta.url), "utf8");

  assert.match(sw, /callup-shell-v113-staff-performance/);

  assert.match(sw, /features\/dispatch-times\.js/);
  assert.match(app, /formatEstimate\(/);
  assert.match(app, /timeSource/);
  assert.match(app, /planAutoTimes\(/);
  assert.doesNotMatch(src, /updateDoc|setDoc|addDoc/);
  assert.doesNotMatch(src, /collection\(db,\s*["']timesheets["']/);
  const persist = app.slice(app.indexOf("// BEGIN DISPATCH PERSIST"), app.indexOf("// END DISPATCH PERSIST"));
  assert.match(persist, /"jobs"/);
  assert.doesNotMatch(persist, /timesheets/);
  assert.doesNotMatch(persist, /durationHrs/);
});
