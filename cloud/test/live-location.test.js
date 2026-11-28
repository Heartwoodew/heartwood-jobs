import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMPANY_TIME_ZONE, CREW_UNSHARED, LIVE_LIMIT_NOTE, LIVE_SHARE_TEXT, MAP_LIBRARY, MAP_OFFLINE, MAP_TILES, SHARE_FIX_WAIT_MS, SHARE_MIN_METRES, SHARE_MIN_MS,
  SHOW_AFTER_CLOCK_OFF, STALE_MINUTES,
  canSeeCrewMap, clockOffLocationUpdate, companySharesLocation, companyTimeZone, crewListHtml, crewMapModel, crewMapNotice, crewPinNote, haversineMetres, homeCrewSlot, isPositionStale, jobPoint,
  lastSeenLabel, liveCollectionPath, liveLocationBody, mapFailureStatus, seenClock, shareIndicator, shouldSendPosition, showOnCrewMap,
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
  assert.deepEqual(model.people.map(p => p.name), ["Gone", "Lee", "Sam"]);
  assert.equal(model.people.find(p => p.uid === "lab1").sharing, "off");
  assert.equal(model.people.find(p => p.uid === "gone").clockedOn, false);
  assert.equal(model.people.find(p => p.uid === "gone").dot, "off");
  assert.match(model.people.find(p => p.uid === "gone").markerLabel, /Gone, last seen unknown \(clocked off, stale\)/);
  assert.equal(model.people.find(p => p.uid === "nostatus"), undefined);
  const sam = model.people.find(p => p.uid === "op1");
  assert.equal(sam.jobs.length, 1);
  assert.equal(sam.jobs[0].jobNo, "659");
  assert.equal(sam.jobs[0].lat, -27.48);
  assert.equal(sam.jobs[0].invoiceAmount, undefined);
  assert.equal(sam.jobs[0].poAmount, undefined);
  assert.deepEqual(model.jobs.map(j => j.id), ["j1"]);
  assert.equal(model.jobs[0].lat, -27.48);
  assert.equal(model.jobs[0].invoiceAmount, undefined);
  assert.equal(model.unpinned, 1);
  assert.equal(model.people.find(p => p.uid === "lab1").jobs[0].lat, null);
  assert.equal(jobPoint({ address: "10 Creek Rd, Brisbane", geo: { lat: 1, lng: 2, query: "somewhere else" } }), null);
  const html = crewListHtml(model, s => String(s));
  assert.match(html, /Clocked on, location not shared/);
  assert.equal(crewMapNotice(model), "Lee — " + CREW_UNSHARED);
  assert.equal(crewMapNotice({ people: [{ name: "Sam", sharing: "gps" }] }), "");
  assert.equal(mapFailureStatus({ online: false, reason: "map-unavailable" }).text, MAP_OFFLINE);
  assert.equal(mapFailureStatus({ online: true, reason: "map-timeout" }).text, MAP_LIBRARY);
  assert.equal(mapFailureStatus({ online: true, reason: "tiles" }).text, MAP_TILES);
  assert.equal(mapFailureStatus({ online: true, reason: "tiles" }).retry, true);
  assert.equal(SHARE_FIX_WAIT_MS, 20000);
  assert.match(html, /Orbit/);
  assert.match(html, /no pin/);
  assert.doesNotMatch(html, /8800|1200|500|invoice|\$/);
  assert.doesNotMatch(JSON.stringify(model), /8800|1200|500|invoiceAmount|poAmount|quoteAmount|\$/);
  assert.match(lastSeenLabel(now, now), /just now/i);
  assert.match(shareIndicator({ clockedOn: true, sharing: "gps" }).text, /Location sharing on/);
  assert.equal(shareIndicator({ clockedOn: true, sharing: "off" }).text, "Location off");
  assert.equal(shareIndicator({ clockedOn: false, sharing: "gps" }).visible, false);
  assert.equal(shareIndicator({ clockedOn: true, sharing: "ask" }).text, LIVE_SHARE_TEXT);
  assert.match(LIVE_LIMIT_NOTE, /locked/);
});

test("every company keeps the last position, fades it after 10 minutes, and keeps it after clock off", () => {
  assert.equal(SHOW_AFTER_CLOCK_OFF, true);
  assert.equal(STALE_MINUTES, 10);
  assert.equal(COMPANY_TIME_ZONE, "Australia/Brisbane");
  assert.deepEqual(clockOffLocationUpdate("stamp"), { clockedOn: false, clockedOffAt: "stamp" });
  const now = new Date("2026-11-24T05:12:00Z");
  const fresh = new Date(now.getTime() - 9 * 60 * 1000);
  const old = new Date(now.getTime() - 11 * 60 * 1000);
  const edge = new Date(now.getTime() - STALE_MINUTES * 60 * 1000);
  assert.equal(seenClock(now, "Australia/Brisbane"), "3:12pm");
  assert.equal(isPositionStale(old, now), true);
  assert.equal(isPositionStale(fresh, now), false);
  assert.equal(isPositionStale(edge, now), false);
  assert.equal(isPositionStale(null, now), true);
  for (const companyId of ["heartwood", "bravo", "yardco"]) {
    assert.equal(companyTimeZone({ companyId, timeZone: "" }), "Australia/Brisbane");
    assert.equal(companyTimeZone(companyId), "Australia/Brisbane");
    assert.equal(companyTimeZone({ companyId, timeZone: "Australia/Perth" }), "Australia/Perth");
    const model = crewMapModel({
      now,
      today: "2026-11-24",
      timeZone: companyTimeZone({ companyId }),
      locations: [
        { uid: "pat", name: "Pat", companyId, clockedOn: true, sharing: "gps", lat: -27.6, lng: 153.02, accuracy: 8, updatedAt: old },
        { uid: "sam", name: "Sam", companyId, clockedOn: false, sharing: "gps", lat: -27.5, lng: 152.9, accuracy: 12, updatedAt: now, clockedOffAt: now },
        { uid: "lee", name: "Lee", companyId, clockedOn: true, sharing: "off", updatedAt: old },
        { uid: "nope", name: "Nope", companyId, clockedOn: false, sharing: "off", updatedAt: now },
      ],
      jobs: [
        { id: "j1", date: "2026-11-24", status: "Scheduled", client: "Orbit", address: "10 Creek Rd", time: "07:00", assigned: ["pat"], invoiceAmount: 8800, geo: { lat: -27.48, lng: 153.03, query: "10 Creek Rd" } },
      ],
    });
    const pat = model.people.find(p => p.uid === "pat");
    const sam = model.people.find(p => p.uid === "sam");
    assert.equal(pat.stale, true);
    assert.equal(pat.dot, "stale");
    assert.equal(pat.lat, -27.6);
    assert.equal(pat.clockedOn, true);
    assert.equal(pat.markerLabel, "Pat, last seen 3:01pm (stale)");
    assert.equal(sam.dot, "off");
    assert.equal(sam.stale, false);
    assert.equal(sam.clockedOn, false);
    assert.equal(sam.lat, -27.5);
    assert.equal(sam.markerLabel, "Sam, last seen 3:12pm (clocked off)");
    assert.equal(model.people.find(p => p.uid === "lee").sharing, "off");
    assert.equal(model.people.find(p => p.uid === "nope"), undefined);
    assert.equal(model.jobs[0].invoiceAmount, undefined);
    const html = crewListHtml(model, s => String(s));
    assert.match(html, /Pat, last seen 3:01pm \(stale\)/);
    assert.match(html, /Sam, last seen 3:12pm \(clocked off\)/);
    assert.match(html, /crew-card stale/);
    assert.match(html, /crew-card off/);
    assert.doesNotMatch(html, /8800|\$/);
  }
  const hidden = crewMapModel({
    now,
    today: "2026-11-24",
    showAfterClockOff: false,
    locations: [
      { uid: "pat", name: "Pat", companyId: "bravo", clockedOn: true, sharing: "gps", lat: -27.6, lng: 153, updatedAt: old },
      { uid: "sam", name: "Sam", companyId: "bravo", clockedOn: false, sharing: "gps", lat: -27.5, lng: 152.9, updatedAt: now },
    ],
  });
  assert.deepEqual(hidden.people.map(p => p.uid), ["pat"]);
  assert.equal(hidden.people[0].dot, "stale");
  assert.equal(showOnCrewMap({ clockedOn: false, sharing: "gps", lat: 1, lng: 2 }, false), false);
  assert.equal(showOnCrewMap({ clockedOn: true, sharing: "gps", lat: 1, lng: 2, updatedAt: old }, false), true);
  const src = read("../../app/features/live-location.js");
  const modelFn = src.slice(src.indexOf("export function crewMapModel"), src.indexOf("export function crewPinNote"));
  assert.doesNotMatch(modelFn, /heartwood/);
  assert.doesNotMatch(src.slice(src.indexOf("export function companyTimeZone"), src.indexOf("export function seenClock")), /heartwood/);
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
  assert.match(prod, /llRole\(\) == "admin" \|\| llRole\(\) == "manager" \|\| llRole\(\) == "supervisor"/);
  assert.doesNotMatch(prod, /llRole\(\) == "operator"|llRole\(\) == "labourer"/);
  assert.match(prod, /entry.status == "open" \|\| entry.status == "break"/);
  assert.match(prod, /allow delete: if signedIn\(\) && request.auth.uid == id/);
  assert.match(prod, /function llClockOff\(id\)/);
  assert.match(prod, /function llMap\(\)/);
  assert.match(prod, /function llKeepsFix\(\)/);
  assert.match(prod, /clockedOffAt == request.time/);
  assert.match(prod, /prevData\(\).clockedOn == true \|\| llMap\(\)/);
  assert.equal((prod.match(/function llClockOff\(id\)/g) || []).length, 2);
  assert.equal((prod.match(/llClockOff\(id\)/g) || []).length, 4);
  const clockOffFns = prod.match(/function llClockOff\(id\) \{[\s\S]*?\n      \}/g) || [];
  assert.equal(clockOffFns.length, 2);
  for (const fn of clockOffFns) assert.doesNotMatch(fn, /heartwood/);
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

test("pinned jobs stay on the map when nobody is clocked on, with no prices", () => {
  const model = crewMapModel({
    today: "2026-11-24",
    locations: [],
    jobs: [
      { id: "later", date: "2026-11-24", status: "Scheduled", address: "20 River Rd, Ipswich", time: "11:00", client: "North", invoiceAmount: 8800, poAmount: 1200, geo: { lat: -27.6, lng: 152.76, query: "20 River Rd, Ipswich" } },
      { id: "early", date: "2026-11-24", status: "In progress", address: "4 Mill St, Brisbane", time: "07:30", assigned: ["nobody"], quoteAmount: 500, geo: { lat: -27.5, lng: 153.01, query: "4 Mill St, Brisbane" } },
      { id: "cancel", date: "2026-11-24", status: "Cancelled", address: "1 Cancel St", invoiceAmount: 100, geo: { lat: -27.1, lng: 153.1, query: "1 Cancel St" } },
      { id: "fail", date: "2026-11-24", status: "Scheduled", sm8Status: "Unsuccessful", address: "2 Fail St", geo: { lat: -27.2, lng: 153.2, query: "2 Fail St" } },
      { id: "yday", date: "2026-11-23", status: "Scheduled", address: "Yesterday", geo: { lat: -27.3, lng: 153.3, query: "Yesterday" } },
      { id: "mismatch", date: "2026-11-24", status: "Scheduled", address: "9 Other St", geo: { lat: -27.4, lng: 153.4, query: "somewhere else" } },
      { id: "bare", date: "2026-11-24", status: "Scheduled", address: "8 Bare St", client: "Plain", quoteAmount: 500 },
      { id: "blank", date: "2026-11-24", status: "Scheduled", client: "No address" },
    ],
  });
  assert.deepEqual(model.people, []);
  assert.deepEqual(model.jobs.map(j => j.id), ["early", "later"]);
  assert.equal(model.jobs[0].lat, -27.5);
  assert.equal(model.jobs[0].lng, 153.01);
  assert.equal(model.unpinned, 2);
  assert.equal(crewPinNote(model), "2 of today's jobs have an address but no pin.");
  assert.equal(crewPinNote({ unpinned: 1 }), "1 of today's jobs has an address but no pin.");
  assert.equal(crewPinNote({ unpinned: 0 }), "");
  assert.deepEqual(Object.keys(model.jobs[0]).sort(), ["address", "client", "id", "jobNo", "label", "lat", "lng", "time"]);
  const html = crewListHtml(model, s => String(s));
  assert.match(html, /Nobody is clocked on/);
  assert.doesNotMatch(html, /8800|1200|500|100|invoice|quoteAmount|\$/);
  assert.doesNotMatch(JSON.stringify(model), /8800|1200|500|invoiceAmount|poAmount|quoteAmount|\$/);
  assert.equal(jobPoint({ address: "9 Other St", geo: { lat: -27.4, lng: 153.4, query: "somewhere else" } }), null);
});

test("the map library is not part of the offline shell", () => {
  const sw = read("../../app/sw.js");
  const app = read("../../app/app.js");
  const css = read("../../app/styles.css");

  assert.match(sw, /callup-shell-v168-profile-lock/);
  assert.match(app, /releaseLiveDoc/);
  assert.match(app, /clockOffLocationUpdate/);
  assert.match(app, /SHOW_AFTER_CLOCK_OFF/);
  assert.match(app, /p\.markerLabel/);
  assert.match(app, /crewPersonIcon/);
  assert.match(css, /\.crew-pin span\.off/);
  assert.match(css, /\.crew-pin span\.stale/);
  const release = app.slice(app.indexOf("function releaseLiveDoc"), app.indexOf("function liveShareStop"));
  assert.match(release, /SHOW_AFTER_CLOCK_OFF/);
  assert.match(release, /liveCollectionPath\(companyId\)/);
  assert.doesNotMatch(release, /heartwood/);
  assert.match(sw, /features\/live-location\.js/);
  assert.doesNotMatch(sw, /leaflet|openstreetmap|unpkg\.com/i);
  assert.match(app, /LIVE_SHARE_TEXT/);
  assert.match(app, /vendor\/leaflet\/leaflet\.js/);
  assert.match(app, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(app, /mapFailureStatus/);
  assert.match(app, /crewmapretry/);
  assert.match(app, /noteShareHidden/);
  assert.match(app, /SHARE_FIX_WAIT_MS/);
  assert.doesNotMatch(app, /import [^;]*leaflet/i);
  assert.match(css, /#crewmapretry\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.sm-btn\[hidden\]\{display:none!important\}/);
  const mapFn = app.slice(app.indexOf("async function ensureCrewMap"), app.indexOf("async function tsPunch"));
  assert.match(mapFn, /for \(const j of model\.jobs/);
  assert.doesNotMatch(mapFn, /for \(const j of p\.jobs\)/);
  assert.match(app, /crewPinNote\(model\)/);
  assert.match(app, /function canUpdateJobs\(/);
  assert.match(app, /geocodeAddress\(/);
  assert.match(app, /cacheGeo\(job, hit\)/);
  assert.match(app, /resolveConfig\(\)/);
});
