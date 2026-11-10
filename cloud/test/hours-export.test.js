import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import * as m from "../../app/features/hours-export.js";

function fakeDoc() {
  const clicks = [];
  const doc = {
    clicks,
    body: { appendChild() {} },
    createElement() {
      const link = { href: "", download: "", rel: "", click() { clicks.push({ href: link.href, download: link.download }); } };
      return link;
    },
  };
  return doc;
}
const windows = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  platform: "Win32",
  maxTouchPoints: 0,
};
const iphone = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};

test("hours xlsx: every day, summary leave counts, subtotals, no ids, valid zip", async () => {
  const rep = m.buildHoursReport({ weekStart: "2026-11-02", people: [{ uid: "u1", name: "Sam" }, { uid: "u2", name: "Al" }],
    sheets: [{ uid: "u1", entries: { e1: { id: "e1", date: "2026-11-03", start: "06:00", finish: "14:30", source: "manual", job: "J1" } } }],
    leaves: [{ uid: "u2", name: "Al", status: "approved", type: "sick", start: "2026-11-05", end: "2026-11-05", startHalf: "", endHalf: "" }] });
  assert.equal(rep.total, 8);
  assert.equal(rep.sick, 1);
  assert.deepEqual(rep.people.map(p => [p.name, p.total, p.sick, p.days.length]), [["Al", 0, 1, 7], ["Sam", 8, 0, 7]]);
  assert.equal(rep.people[0].days[3].leaveText, "Sick leave");
  assert.equal(rep.people[0].days[3].total, 0);
  assert.equal(rep.people[0].days[0].leaveText, "Day off");
  assert.equal(rep.people[1].days[1].total, 8);
  assert.equal(rep.people[1].days[1].shifts[0].breakMins, null);
  assert.equal(rep.people[1].days[0].leaveText, "Day off");
  const sheets = m.reportSheets(rep, { company: "Heartwood", generated: new Date("2026-11-08T06:00:00Z") });
  assert.deepEqual(sheets.map(s => s.name), ["Summary", "Detail"]);
  assert.match(sheets[1].xml, /Sam week total/);
  assert.match(sheets[1].xml, /03\/11\/2026/);
  assert.match(sheets[1].xml, /Tuesday/);
  assert.match(sheets[1].xml, /6:00 am/);
  assert.match(sheets[1].xml, /2:30 pm/);
  assert.match(sheets[1].xml, /Day off/);
  assert.match(sheets[1].xml, /Day total/);
  assert.match(sheets[0].xml, /Mon 02\/11/);
  assert.match(sheets[0].xml, /Tue 03\/11/);
  assert.match(sheets[0].xml, /Sun 08\/11/);
  assert.match(sheets[0].xml, />Total</);
  assert.match(sheets[0].xml, /Grand total/);
  assert.match(sheets[0].xml, />Sick</);
  assert.match(sheets[0].xml, /<v>8<\/v>/);
  assert.match(sheets[0].xml, /<v>0<\/v>/);
  assert.doesNotMatch(sheets[0].xml, /Annual leave days|Sick days/);
  assert.doesNotMatch(sheets[1].xml, /u1|e1|30 min/);
  const b = m.xlsxBytes(sheets);
  assert.equal(b[0], 0x50); assert.equal(b[1], 0x4b);
  assert.equal(m.exportFileName("Heartwood Earthworks", "2026-11-02"), "Heartwood_Earthworks_hours_2026-11-02_to_2026-11-08.xlsx");
  assert.match(m.newExportId(), /^hx[a-z0-9]{16}$/);
  assert.equal(m.ACCOUNTS_TO, "accounts@heartwoodew.com");
});

test("a day lists each shift from stored fields, and leave follows the request", () => {
  const jobs = [{ sm8JobNo: "2402", address: "14 Brightvale Street" }, { sm8JobNo: "2403", address: "14 Brightvale Street" }];
  const sheet = {
    uid: "u1",
    entries: {
      a: {
        id: "entryA", source: "clock", status: "closed", date: "2026-11-03", start: "07:00", finish: "12:00",
        breakStart: "09:00", breakEnd: "09:20", job: "#2402", note: "Slab",
        machineChoice: "asset", machineId: "ex1", machineName: "Excavator",
      },
      b: {
        id: "entryB", source: "manual", status: "closed", date: "2026-11-03", start: "12:30", finish: "16:00",
        job: "Depot", note: "Yard", machineChoice: "none", machineId: "", machineName: "",
      },
    },
    days: { "2026-11-04": { note: "Dentist" } },
  };
  const leaves = [
    { uid: "u1", name: "Sam", status: "approved", type: "annual", start: "2026-11-02", end: "2026-11-02", startHalf: "am", endHalf: "am", certificatePath: "" },
    { uid: "u1", name: "Sam", status: "approved", type: "sick", start: "2026-11-05", end: "2026-11-05", startHalf: "", endHalf: "", certificatePath: "leaveCertificates/u1/lv0123456789abcdef/cert.pdf", certificateName: "secret-scan.pdf" },
    { uid: "u1", name: "Sam", status: "pending", type: "annual", start: "2026-11-06", end: "2026-11-06", startHalf: "", endHalf: "" },
    { uid: "u1", name: "Sam", status: "declined", type: "other", start: "2026-11-07", end: "2026-11-07", startHalf: "", endHalf: "", reason: "Declined holiday" },
  ];
  const rep = m.buildHoursReport({ weekStart: "2026-11-02", people: [{ uid: "u1", name: "Sam" }], sheets: [sheet], leaves, jobs });
  const days = rep.people[0].days;
  assert.equal(rep.total, 7.67);
  assert.equal(days[0].leaveText, "Annual leave · morning only");
  assert.equal(days[0].leaveShort, "Annual");
  assert.equal(days[0].total, 0);
  assert.equal(days[1].shifts.length, 2);
  assert.equal(days[1].shifts[0].breakMins, 20);
  assert.equal(days[1].shifts[0].hours, 4.67);
  assert.equal(days[1].shifts[0].site, "2402 · 14 Brightvale Street");
  assert.equal(days[1].shifts[0].machine, "Excavator");
  assert.equal(days[1].shifts[0].job, "#2402");
  assert.equal(days[1].shifts[1].hours, 3);
  assert.equal(days[1].shifts[1].breakMins, null);
  assert.equal(days[1].shifts[1].site, "");
  assert.equal(days[1].shifts[1].machine, "No machine / other work");
  assert.equal(days[1].total, 7.67);
  assert.equal(days[1].leaveText, "");
  assert.equal(days[2].note, "Dentist");
  assert.equal(days[2].leaveText, "Day off");
  assert.equal(days[2].shifts.length, 0);
  assert.equal(days[3].leaveText, "Sick leave · Medical certificate");
  assert.equal(days[3].leaveShort, "Sick");
  assert.equal(days[4].leaveText, "Leave requested (pending)");
  assert.equal(days[4].leaveShort, "Pending");
  assert.equal(days[5].leaveText, "Day off");
  assert.equal(days[6].total, 0);
  assert.equal(rep.people[0].annual, 0.5);
  assert.equal(rep.people[0].sick, 1);
  assert.equal(rep.people[0].other, 0);
  assert.equal(rep.people[0].pending, 1);
  const shared = m.shiftRows({ entries: { a: { date: "2026-11-03", start: "07:00", finish: "15:00", job: "14 Brightvale Street", source: "manual" } } }, jobs);
  assert.equal(shared[0].site, "");
  const built = m.reportSheets(rep, { company: "Heartwood", generated: new Date("2026-11-08T06:00:00Z") });
  const xml = built.map(s => s.xml).join("\n");
  assert.match(built[0].xml, /Mon 02\/11/);
  assert.match(built[0].xml, />Annual</);
  assert.match(built[0].xml, />Sick</);
  assert.match(built[0].xml, />Pending</);
  assert.match(built[0].xml, /<v>7\.67<\/v>/);
  assert.match(xml, /9:00 am/);
  assert.match(xml, /9:20 am/);
  assert.match(xml, /Sam week total/);
  assert.match(xml, /Grand total/);
  assert.doesNotMatch(xml, /30 min lunch|secret-scan|Declined holiday|leaveCertificates|entryA|ex1/);
});

test("desktop download does not call canShare, even when canShare throws", async () => {
  const doc = fakeDoc();
  let shares = 0, cans = 0;
  const prev = URL.createObjectURL, prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:desktop";
  URL.revokeObjectURL = () => {};
  try {
    const saved = await m.deliverHoursFile({
      bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
      filename: "Heartwood_hours_2026-11-02_to_2026-11-08.xlsx",
      nav: { ...windows, canShare() { cans++; throw new TypeError("canShare exploded"); }, share() { shares++; } },
      doc,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.via, "download");
    assert.equal(cans, 0);
    assert.equal(shares, 0);
    assert.deepEqual(doc.clicks, [{ href: "blob:desktop", download: "Heartwood_hours_2026-11-02_to_2026-11-08.xlsx" }]);
  } finally { URL.createObjectURL = prev; URL.revokeObjectURL = prevRevoke; }
});

test("iPhone uses the share sheet, and a throwing or false canShare falls back to the anchor", async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
  const filename = "Heartwood_hours.xlsx";
  let shared = null;
  const sharedOk = await m.deliverHoursFile({
    bytes, filename,
    nav: { ...iphone, canShare() { return true; }, async share(data) { shared = data.files[0].name; } },
    doc: fakeDoc(),
  });
  assert.equal(sharedOk.via, "share");
  assert.equal(shared, filename);

  const prev = URL.createObjectURL, prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:ios";
  URL.revokeObjectURL = () => {};
  try {
    const thrown = fakeDoc();
    const fell = await m.deliverHoursFile({
      bytes, filename,
      nav: { ...iphone, canShare() { throw new TypeError("files not shareable"); }, share() { throw new Error("share should not run"); } },
      doc: thrown,
    });
    assert.equal(fell.via, "download");
    assert.equal(fell.ok, true);
    assert.equal(thrown.clicks.length, 1);
    const refused = fakeDoc();
    const no = await m.deliverHoursFile({
      bytes, filename,
      nav: { ...iphone, canShare() { return false; }, share() { throw new Error("share should not run"); } },
      doc: refused,
    });
    assert.equal(no.via, "download");
    assert.equal(refused.clicks.length, 1);
    const cancelled = await m.deliverHoursFile({
      bytes, filename,
      nav: { ...iphone, canShare() { return true; }, share() { const e = new Error("closed"); e.name = "AbortError"; throw e; } },
      doc: fakeDoc(),
    });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.via, "share");
  } finally { URL.createObjectURL = prev; URL.revokeObjectURL = prevRevoke; }
});

test("hours buttons do not call an undefined rerender, and list errors stay visible", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const run = app.slice(app.indexOf("async function hxRun"), app.indexOf("function tsView"));
  const subs = app.slice(app.indexOf("function hxSubs"), app.indexOf("async function hxRun"));
  assert.doesNotMatch(run, /\brerender\(/);
  assert.doesNotMatch(subs, /\brerender\(/);
  assert.match(run, /ui\.tsPaint|hxPaint\(/);
  assert.match(run, /deliverHoursFile/);
  assert.match(run, /id="hxerr"|ui\.hxErr/);
  assert.match(subs, /Hours spreadsheet list not available/);
  assert.match(app, /hxg\.onclick/);
  assert.match(sw, /u\.protocol === "blob:"/);
  assert.match(sw, /callup-shell-v85-trial/);
  const slice = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b) + b.length);
  assert.equal(
    slice(readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8"), "// BEGIN HOURS EXPORT RULES", "// END HOURS EXPORT RULES"),
    slice(readFileSync(new URL("../production/firestore.hours-export.rules", import.meta.url), "utf8"), "// BEGIN HOURS EXPORT RULES", "// END HOURS EXPORT RULES"),
  );
  assert.equal(
    slice(readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8"), "// BEGIN HOURS EXPORT FILE RULES", "// END HOURS EXPORT FILE RULES"),
    slice(readFileSync(new URL("../production/storage.hours-export.rules", import.meta.url), "utf8"), "// BEGIN HOURS EXPORT FILE RULES", "// END HOURS EXPORT FILE RULES"),
  );
});
