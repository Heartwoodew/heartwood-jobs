import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accuracyText, assessClockAdjust, captureFix, coordText, daysForSheet, entryTimeEdited, machineChoicePatch, machinePromptNeeded, machineShiftToResume, mapsHref,
  needsLocationConsent, paidShift, periodOpenForWorker, prestartStatus, sheetHours, shiftHours,
} from "../../app/features/timesheet.js";

test("finished shifts keep the 30-minute lunch unless a break is entered", () => {
  assert.equal(shiftHours({ start: "07:00", finish: "15:30" }), 8);
  assert.equal(shiftHours({ start: "07:00", finish: "15:30", breakStart: "12:00", breakEnd: "12:30" }), 8);
  assert.equal(shiftHours({ start: "07:00", finish: "15:30", breakStart: "12:00", breakEnd: "12:20" }), 8.17);
  assert.equal(shiftHours({ start: "22:00", finish: "06:00" }), 7.5);
  assert.equal(shiftHours({ start: "07:00", finish: "" }), 0);
});

test("clocked hours follow the server stamp until someone edits the shift", () => {
  const clocked = {
    source: "clock", start: "06:59", finish: "15:01", edits: {},
    clockOn: { at: { seconds: Date.parse("2026-11-05T20:58:00Z") / 1000 } },
    clockOff: { at: { seconds: Date.parse("2026-11-06T05:04:00Z") / 1000 } },
  };
  const paid = paidShift(clocked);
  assert.equal(paid.start, "06:58");
  assert.equal(paid.finish, "15:04");
  const edited = paidShift({ ...clocked, start: "07:00", edits: { e1: { summary: "Start" } } });
  assert.equal(edited.start, "07:00");
});

test("sheet totals do not count a typed day twice when a shift exists", () => {
  const sheet = {
    days: { "2026-11-06": { start: "07:00", finish: "15:00", note: "old" }, "2026-11-07": { start: "07:00", finish: "15:30" } },
    entries: { a: { id: "a", source: "manual", date: "2026-11-06", start: "08:00", finish: "12:00", edits: {} } },
  };
  assert.equal(sheetHours(sheet), 3.5 + 8);
  const days = daysForSheet(sheet);
  assert.equal(days["2026-11-06"].start, "08:00");
  assert.equal(days["2026-11-07"].start, "07:00");
});

test("location is one fix, and a denied fix is marked no location", async () => {
  let calls = 0;
  const fix = await captureFix({
    getCurrentPosition(ok, err, opts) {
      calls += 1;
      assert.equal(opts.maximumAge, 0);
      assert.equal(opts.enableHighAccuracy, true);
      ok({ coords: { latitude: -27.47, longitude: 153.025, accuracy: 12.4 } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(fix.fix, "gps");
  assert.equal(mapsHref(fix.lat, fix.lng), "https://www.google.com/maps?q=-27.47,153.025");
  assert.equal(accuracyText({ ...fix, fix: "gps" }), "±12 m");
  assert.equal(coordText({ fix: "gps", lat: fix.lat, lng: fix.lng }), "-27.47000, 153.02500");
  const denied = await captureFix({ getCurrentPosition(ok, err) { err(new Error("denied")); } });
  assert.deepEqual(denied, { fix: "no location" });
  const hung = await captureFix({ getCurrentPosition() {} }, { timeoutMs: 20, positionTimeout: 10 });
  assert.deepEqual(hung, { fix: "no location" });
  assert.equal(needsLocationConsent({ stored: false, already: false }), true);
  assert.equal(needsLocationConsent({ stored: true, already: false }), false);
});

test("the machine question is once per shift and does not guess", () => {
  const open = { id: "e1", source: "clock", status: "open" };
  assert.equal(machinePromptNeeded(open, "e1"), true);
  assert.equal(machinePromptNeeded({ ...open, machineChoice: "skip" }, "e1"), false);
  assert.equal(machinePromptNeeded(open, "e2"), false);
  assert.equal(machinePromptNeeded(open, ""), false);
  assert.deepEqual(machineChoicePatch("skip"), { machineChoice: "skip", machineId: "", machineName: "" });
  assert.deepEqual(machineChoicePatch("none"), { machineChoice: "none", machineId: "", machineName: "" });
  assert.equal(machineChoicePatch("asset", null), null);
  assert.equal(machineChoicePatch("asset", { id: "", name: "Excavator" }), null);
  assert.deepEqual(machineChoicePatch("asset", { id: "ex1", name: "Excavator" }), { machineChoice: "asset", machineId: "ex1", machineName: "Excavator" });
});

test("prestart status reads today's checklist and stays quiet when the feature is absent", () => {
  assert.deepEqual(prestartStatus({ available: false, records: [], assetId: "ex1", day: "2026-11-08" }), { kind: "soon" });
  assert.deepEqual(prestartStatus({ available: true, records: [], assetId: "ex1", day: "2026-11-08" }), { kind: "reminder", assetId: "ex1" });
  assert.deepEqual(prestartStatus({ available: true, records: [], assetId: "", day: "2026-11-08" }), { kind: "hidden" });
  const done = prestartStatus({
    available: true,
    records: [
      { assetId: "ex1", day: "2026-11-07", signerName: "Yesterday", signedAt: "2026-11-07T21:00:00Z" },
      { assetId: "ex1", day: "2026-11-08", signerName: "Sam", signedAt: "2026-11-07T21:02:00Z" },
      { assetId: "ex1", day: "2026-11-08", signerName: "Riley", signedAt: "2026-11-07T23:00:00Z" },
    ],
    assetId: "ex1",
    day: "2026-11-08",
  });
  assert.equal(done.kind, "done");
  assert.equal(done.by, "Riley");
});

test("timesheet stamps stay one fix; live sharing watches only while the shift is open", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const feature = readFileSync(new URL("../../app/features/timesheet.js", import.meta.url), "utf8");
  assert.equal((feature.match(/watchPosition/g) || []).length, 0);
  assert.equal((feature.match(/\.getCurrentPosition\(/g) || []).length, 1);
  assert.match(feature, /maximumAge: 0/);
  assert.equal((app.match(/\.watchPosition\(/g) || []).length, 1);
  assert.match(app, /if \(document\.hidden\) \{ noteShareHidden\(\); disarmShareWatch\(\); \}/);
  assert.match(app, /function noteShareHidden\(\)/);
  assert.match(app, /if \(kind === "off"\) liveShareStop\(true\)/);
  assert.doesNotMatch(app + feature, /locationHistory|liveTrail/);
});

test("timesheet rules fragment matches the emulator block and does not replace other rules", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.timesheet.rules", import.meta.url), "utf8");
  const slice = text => {
    const start = text.indexOf("// BEGIN TIMESHEET RULES");
    const end = text.indexOf("// END TIMESHEET RULES");
    assert.ok(start >= 0 && end > start);
    return text.slice(start, end + "// END TIMESHEET RULES".length);
  };
  assert.equal(slice(emu), slice(frag));
  assert.match(emu, /match \/receipts\/\{id\}/);
  assert.match(emu, /match \/xeroQueue\/\{id\}/);
  assert.match(slice(frag), /prevData\(\)\.uid == request\.auth\.uid/);
  assert.match(slice(frag), /m\.fix == "no location"/);
  assert.match(slice(frag), /allow delete: if false/);
  assert.doesNotMatch(slice(frag), /match \/receipts\/|match \/xeroQueue\/|watchPosition/);
});

test("a worker's clock correction applies immediately and keeps the first original time", () => {
  const entry = {
    id: "e1", source: "clock", status: "closed", date: "2026-11-10", start: "06:58", finish: "15:04",
    clockOn: { at: "2026-11-09T20:58:00Z", fix: "gps", lat: -27.47, lng: 153.02, accuracy: 12 },
    clockOff: { at: "2026-11-10T05:04:00Z", fix: "gps", lat: -27.47, lng: 153.02, accuracy: 9 },
    edits: {}, job: "Lot 12", note: "slab",
  };
  const sheet = { uid: "op1", weekStart: "2026-11-09", weekEnd: "2026-11-15", sent: false };
  const first = assessClockAdjust({
    entry, sheet, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"),
    clockOn: "07:05", clockOff: "15:10",
  });
  assert.equal(first.ok, true);
  assert.equal(first.entry.start, "07:05");
  assert.equal(first.entry.finish, "15:10");
  assert.equal(first.entry.originalClockOn, "06:58");
  assert.equal(first.entry.originalClockOff, "15:04");
  assert.equal(first.entry.job, "Lot 12");
  assert.equal(first.entry.clockOn.lat, -27.47);
  assert.equal(entryTimeEdited(first.entry), true);
  const paid = paidShift({ ...first.entry, edits: { e1: { summary: first.summary } } });
  assert.equal(paid.start, "07:05");
  assert.equal(paid.finish, "15:10");
  const second = assessClockAdjust({
    entry: first.entry, sheet, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"),
    clockOn: "07:15", clockOff: "15:10",
  });
  assert.equal(second.ok, true);
  assert.equal(second.entry.originalClockOn, "06:58");
  assert.equal(second.entry.originalClockOff, "15:04");
  assert.equal(assessClockAdjust({ entry, sheet, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "15:30", clockOff: "07:00" }).reason, "Clock off must be after clock on.");
  assert.equal(assessClockAdjust({ entry, sheet, uid: "op1", today: "2026-11-10", now: new Date("2026-11-10T01:00:00Z"), clockOn: "18:00", clockOff: "18:30" }).reason, "Times can't be in the future.");
  assert.equal(assessClockAdjust({ entry: { ...entry, date: "2026-11-13" }, sheet, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "07:00", clockOff: "15:00" }).reason, "Times can't be in the future.");
  assert.equal(assessClockAdjust({ entry, sheet, uid: "op2", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "07:05", clockOff: "15:10" }).reason, "You can only change your own times.");
  const sent = { ...sheet, weekStart: "2026-11-02", weekEnd: "2026-11-08", sent: true };
  assert.equal(assessClockAdjust({ entry, sheet: sent, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "07:05", clockOff: "15:10" }).reason, "This pay period has already been sent.");
  const approved = { ...sheet, weekStart: "2026-11-02", weekEnd: "2026-11-08", approved: true };
  assert.equal(assessClockAdjust({ entry, sheet: approved, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "07:05", clockOff: "15:10" }).reason, "This pay period is already approved.");
  assert.equal(periodOpenForWorker({ ...sheet, sent: true }, "2026-11-12"), true);
  assert.equal(assessClockAdjust({ entry, sheet: { ...sheet, sent: true }, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T06:00:00Z"), clockOn: "07:05", clockOff: "15:10" }).ok, true);
  assert.equal(assessClockAdjust({ entry, sheet: sent, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "07:05", clockOff: "15:10", admin: true }).ok, true);
  const open = assessClockAdjust({
    entry: { ...entry, status: "open", finish: "", clockOff: undefined },
    sheet, uid: "op1", today: "2026-11-12", now: new Date("2026-11-12T02:00:00Z"), clockOn: "07:00",
  });
  assert.equal(open.ok, true);
  assert.equal(open.entry.finish, "");
  assert.equal(open.entry.originalClockOff, undefined);
});

test("the adjust form is clock times only, and admins see the Edited mark", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const form = app.slice(app.indexOf("function tsAdjustForm"), app.indexOf("function tsManualForm"));
  assert.match(form, /Adjust clock times/);
  assert.match(form, /name="clockOn"/);
  assert.match(form, /name="clockOff"/);
  assert.match(form, /saves straight away/);
  assert.doesNotMatch(form, /name="job"|name="note"|name="breakStart"|poAmount|quoteAmount|invoiceAmount/);
  assert.match(app, /ts-badge edited/);
  assert.match(app, /Original /);
  assert.match(app, /assessClockAdjust/);
  assert.match(app, /periodOpenForWorker/);
});

test("machine question comes back after a reload for an open clock shift with no answer", () => {
  const open = { id: "e1", source: "clock", status: "open" };
  assert.equal(machineShiftToResume(open), true);
  assert.equal(machineShiftToResume({ ...open, status: "break" }), true);
  assert.equal(machineShiftToResume({ ...open, machineChoice: "skip" }), false);
  assert.equal(machineShiftToResume({ ...open, status: "closed" }), false);
  assert.equal(machineShiftToResume({ ...open, source: "manual" }), false);
  assert.equal(machineShiftToResume(null), false);
});

test("operator tab taps force a redraw, and saves let go of focus so lists refresh", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /\[data-tab\]"\)\.forEach\(b => b\.onclick = \(\) => \{ ui\.opTab = b\.dataset\.tab; ui\.forceRender = true;/);
  assert.match(app, /\$\("#burger"\)\.onclick = \(\) => \{ ui\.navOpen = !ui\.navOpen; ui\.forceRender = true; renderAdmin\(\); \}/);
  assert.match(app, /toast\(saved && saved\.queued \? SAVED_ON_PHONE : "Leave request sent"\);\n\s*redrawAfterSave\(\);/);
  assert.match(app, /toast\(saved && saved\.queued \? SAVED_ON_PHONE : \(status === "approved" \? "Leave approved" : "Leave declined"\)\);\n\s*redrawAfterSave\(\);/);
  assert.match(app, /"Invite saved\. Copy the link\. Mail was not sent\."\);\n\s*redrawAfterSave\(\);/);
});
