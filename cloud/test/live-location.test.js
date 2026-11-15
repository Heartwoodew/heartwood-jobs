import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIVE_LIMIT_NOTE, LIVE_SHARE_TEXT, SHARE_MIN_METRES, SHARE_MIN_MS,
  canSeeCrewMap, companySharesLocation, crewListHtml, crewMapModel, haversineMetres, homeCrewSlot, jobPoint,
  lastSeenLabel, liveCollectionPath, liveLocationBody, shareIndicator, shouldSendPosition,
} from "../../app/features/live-location.js";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("only a manager or an admin can open the crew map", () => {
  assert.equal(canSeeCrewMap(null), false);
  for (const role of ["labourer", "operator", "supervisor"]) {
    assert.equal(canSeeCrewMap({ role }), false, role);
    assert.equal(canSeeCrewMap({ role, staffRole: "manager" }), false, role);
  }
  assert.equal(canSeeCrewMap({ role: "manager" }), true);
  assert.equal(canSeeCrewMap({ role: "admin" }), true);
  assert.equal(canSeeCrewMap({ role: "admin", staffRole: "operator" }), true);
  assert.equal(canSeeCrewMap({ role: "admin", staffRole: "manager" }), true);
});

test("a live position is sent on the first fix, after a minute, or after more than 50 metres", () => {
  const here = { sharing: "gps", lat: -27.47, lng: 153.025, at: 1_000_000 };
  assert.equal(shouldSendPosition(null, here, here.at), true);
  const stay = { sharing: "gps", lat: here.lat + 0.0002, lng: here.lng, at: here.at + 1000 };
  assert.ok(haversineMetres(here, stay) < SHARE_MIN_METRES);
  assert.equal(shouldSendPosition(here, stay, here.at + 1000), false);
  assert.equal(shouldSendPosition(here, stay, here.at + SHARE_MIN_MS), true);
  const moved = { sharing: "gps", lat: here.lat + 0.001, lng: here.lng, at: here.at + 1000 };
  assert.ok(haversineMetres(here, moved) > SHARE_MIN_METRES);
  assert.equal(shouldSendPosition(here, moved, here.at + 1000), true);
  assert.equal(shouldSendPosition(here, { sharing: "off" }, here.at + SHARE_MIN_MS), false);
});

test("the stored doc is one position, or location off, and never a trail", () => {
  const gps = liveLocationBody({
    uid: "op1", name: "Sam", companyId: "heartwood", weekStart: "2026-11-09", entryId: "entry0001abcd",
    fix: { fix: "gps", lat: -27.47, lng: 153.025, accuracy: 12.2 },
  });
  assert.equal(gps.sharing, "gps");
  assert.equal(gps.clockedOn, true);
  assert.equal(gps.lat, -27.47);
  assert.equal(gps.accuracy, 12.2);
  assert.equal(gps.trail, undefined);
  const off = liveLocationBody({
    uid: "op1", name: "Sam", companyId: "bravo", weekStart: "2026-11-09", entryId: "entry0001abcd",
    fix: { fix: "no location" },
  });
  assert.equal(off.sharing, "off");
  assert.equal("lat" in off, false);
  assert.equal("lng" in off, false);
  assert.equal("accuracy" in off, false);
  assert.deepEqual(liveCollectionPath("heartwood"), ["liveLocations"]);
  assert.deepEqual(liveCollectionPath("bravo"), ["companies", "bravo", "liveLocations"]);
});

test("the map shows clocked-on crew and today's job pins, with no prices", () => {
  const now = new Date("2026-11-15T01:00:00Z");
  const model = crewMapModel({
    now,
    today: "2026-11-15",
    locations: [
      { uid: "op1", name: "Sam", companyId: "heartwood", clockedOn: true, sharing: "gps", lat: -27.47, lng: 153.02, accuracy: 8, updatedAt: now },
      { uid: "lab1", name: "Lee", companyId: "heartwood", clockedOn: true, sharing: "off", updatedAt: new Date(now.getTime() - 120000) },
      { uid: "gone", name: "Gone", clockedOn: false, sharing: "gps", lat: 1, lng: 1 },
      { uid: "nostatus", name: "No status", sharing: "gps", lat: 1, lng: 1 },
    ],
    jobs: [
      { id: "j1", date: "2026-11-15", status: "Scheduled", client: "Orbit", address: "10 Creek Rd, Brisbane", time: "07:00", sm8JobNo: "659", assigned: ["op1"], invoiceAmount: 8800, poAmount: 1200, geo: { lat: -27.48, lng: 153.03, query: "10 Creek Rd, Brisbane" } },
      { id: "j2", date: "2026-11-15", status: "Scheduled", client: "Other", address: "1 Plain St", assigned: ["lab1"], quoteAmount: 500 },
      { id: "j3", date: "2026-11-14", status: "Scheduled", address: "Yesterday", assigned: ["op1"], geo: { lat: 1, lng: 1, query: "Yesterday" } },
    ],
  });
  assert.deepEqual(model.people.map(p => p.name), ["Lee", "Sam"]);
  assert.equal(model.people.find(p => p.uid === "lab1").sharing, "off");
  assert.equal(model.people.find(p => p.uid === "gone"), undefined);
  assert.equal(model.people.find(p => p.uid === "nostatus"), undefined);
  const sam = model.people.find(p => p.uid === "op1");
  assert.equal(sam.jobs.length, 1);
  assert.equal(sam.jobs[0].jobNo, "659");
  assert.equal(sam.jobs[0].lat, -27.48);
  assert.equal(sam.jobs[0].invoiceAmount, undefined);
  assert.equal(sam.jobs[0].poAmount, undefined);
  assert.equal(model.people.find(p => p.uid === "lab1").jobs[0].lat, null);
  assert.equal(jobPoint({ address: "10 Creek Rd, Brisbane", geo: { lat: 1, lng: 2, query: "somewhere else" } }), null);
  const html = crewListHtml(model, s => String(s));
  assert.match(html, /Location off/);
  assert.match(html, /Orbit/);
  assert.match(html, /no pin/);
  assert.doesNotMatch(html, /8800|1200|500|invoice|\$/);
  assert.match(lastSeenLabel(now, now), /just now/i);
  assert.match(shareIndicator({ clockedOn: true, sharing: "gps" }).text, /Location sharing on/);
  assert.equal(shareIndicator({ clockedOn: true, sharing: "off" }).text, "Location off");
  assert.equal(shareIndicator({ clockedOn: false, sharing: "gps" }).visible, false);
  assert.equal(shareIndicator({ clockedOn: true, sharing: "ask" }).text, LIVE_SHARE_TEXT);
  assert.match(LIVE_LIMIT_NOTE, /locked/);
});

test("live location rules match in the emulator model and the production rules", () => {
  const slice = text => {
    const begin = "// BEGIN LIVE LOCATION RULES", end = "// END LIVE LOCATION RULES";
    const a = text.indexOf(begin), b = text.indexOf(end);
    assert.ok(a >= 0 && b > a);
    return text.slice(a, b + end.length);
  };
  const prod = slice(read("../firestore.production.rules"));
  assert.equal(slice(read("../emulator/firestore.rules")), prod);
  assert.match(prod, /match \/liveLocations\/\{id\}/);
  assert.match(prod, /match \/companies\/\{c\}\/liveLocations\/\{id\}/);
  assert.match(prod, /llRole\(\) == "admin" \|\| llRole\(\) == "manager"/);
  assert.doesNotMatch(prod, /llRole\(\) == "supervisor"|llRole\(\) == "operator"|llRole\(\) == "labourer"/);
  assert.match(prod, /entry.status == "open" \|\| entry.status == "break"/);
  assert.match(prod, /allow delete: if signedIn\(\) && request.auth.uid == id/);
  assert.match(prod, /function llPaused\(id\)/);
  assert.match(prod, /get\(path\)\.data\.get\("status", ""\) == "paused"/);
  assert.match(prod, /!llPaused\("heartwood"\)/);
  assert.match(prod, /companyNotPaused\(c\)/);
});

test("home shows the crew card for managers and admins, and never the profit chart", () => {
  const app = read("../../app/app.js");
  const start = app.indexOf("function homeBody");
  const end = app.indexOf("function homeView");
  assert.ok(start >= 0 && end > start);
  const home = app.slice(start, end);
  assert.equal(home.includes("profitChartHtml"), false);
  assert.doesNotMatch(home, /Profit by month|net profit|\$\$\(/);
  assert.match(home, /homeCrewCard\(\)/);
  assert.equal(homeCrewSlot({ role: "manager" }), "crew");
  assert.equal(homeCrewSlot({ role: "admin" }), "crew");
  assert.equal(homeCrewSlot({ role: "admin", staffRole: "operator" }), "crew");
  for (const role of ["supervisor", "operator", "labourer"]) {
    assert.equal(homeCrewSlot({ role }), "none", role);
    assert.equal(homeCrewSlot({ role, staffRole: "manager" }), "none", role);
  }
  assert.equal(companySharesLocation(null), true);
  assert.equal(companySharesLocation({}), true);
  assert.equal(companySharesLocation({ status: "active" }), true);
  assert.equal(companySharesLocation({ status: "paused" }), false);
  assert.match(app, /ui\.companyStatus/);
  assert.match(app, /companySharesLocation\(\{ status: ui\.companyStatus \}\)/);
  const today = app.slice(app.indexOf('if (ui.opTab === "today")'), app.indexOf("const groups = ui.opTab"));
  assert.match(today, /homeCrewCard\(\)/);
  assert.doesNotMatch(today, /profitChartHtml|\$\$\(/);
});

test("the map library is not part of the offline shell", () => {
  const sw = read("../../app/sw.js");
  const app = read("../../app/app.js");

  assert.match(sw, /callup-shell-v113-staff-performance/);

  assert.match(sw, /features\/live-location\.js/);
  assert.doesNotMatch(sw, /leaflet|openstreetmap|unpkg\.com/i);
  assert.match(app, /LIVE_SHARE_TEXT/);
  assert.match(app, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.doesNotMatch(app, /import [^;]*leaflet/i);
});
