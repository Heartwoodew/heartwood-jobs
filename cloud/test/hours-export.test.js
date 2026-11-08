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
  assert.match(sw, /callup-shell-v75-hours-download/);
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
