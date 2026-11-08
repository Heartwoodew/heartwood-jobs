import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accuracyText, captureFix, coordText, daysForSheet, mapsHref, needsLocationConsent, paidShift,
  sheetHours, shiftHours,
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

test("timesheet code never watches the device location", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const feature = readFileSync(new URL("../../app/features/timesheet.js", import.meta.url), "utf8");
  const combined = app + feature;
  assert.equal((combined.match(/watchPosition/g) || []).length, 0);
  assert.equal((feature.match(/\.getCurrentPosition\(/g) || []).length, 1);
  assert.match(feature, /maximumAge: 0/);
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
  assert.match(slice(frag), /resource\.data\.uid == request\.auth\.uid/);
  assert.match(slice(frag), /m\.fix == "no location"/);
  assert.match(slice(frag), /allow delete: if false/);
  assert.doesNotMatch(slice(frag), /match \/receipts\/|match \/xeroQueue\/|watchPosition/);
});
