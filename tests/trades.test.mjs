import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRADE, LAZY_EARTHWORKS_IDS, TRADES, QUOTE_PACKS,
  addTitle, defaultTitles, levelForTitleName, measureQty, normalizeTrade, quotePack,
  readyJobTypeMap, removeTitle, renameTitle, resolveCompanySetup, sanitizeSkills, setTitleLevel,
} from "../app/features/trades.js";
import {
  COMPANY_SETTINGS_ROLES, CREW_ROLES, INVITE_ROLES, MONEY_ROLES, RATE_ROLES,
  editsCompanyRates, editsCompanySettings, invitableRoles, seesMoney,
} from "../app/features/staff-invites.js";
import { resolveMembership } from "../app/features/cloud-storage.js";
import { calcQuote } from "../app/features/quotes.js";

test("permission levels put manager between supervisor and admin", () => {
  assert.deepEqual([...INVITE_ROLES], ["labourer", "operator", "supervisor", "manager", "admin"]);
  assert.deepEqual([...MONEY_ROLES], ["supervisor", "manager", "admin"]);
  assert.deepEqual([...RATE_ROLES], ["manager", "admin"]);
  assert.deepEqual([...COMPANY_SETTINGS_ROLES], ["admin"]);
  assert.deepEqual([...CREW_ROLES], ["labourer", "operator"]);
  for (const role of CREW_ROLES) assert.equal(seesMoney(role), false);
  assert.equal(seesMoney("supervisor"), true);
  assert.equal(editsCompanyRates("supervisor"), false);
  assert.equal(editsCompanyRates("manager"), true);
  assert.equal(editsCompanySettings("manager"), false);
  assert.equal(editsCompanySettings("admin"), true);
  const mgr = { uid: "m", profile: { role: "manager" }, tenantId: "acme" };
  assert.deepEqual([...invitableRoles(mgr)], ["labourer", "operator", "supervisor", "manager"]);
  assert.equal(invitableRoles(mgr).includes("admin"), false);
});

test("a manager sees money and is not a rules admin; crew still do not", () => {
  const manager = resolveMembership({ uid: "m1", profile: { role: "manager", tenantId: "acme" } });
  assert.equal(manager.canSeeMoney, true);
  assert.equal(manager.rulesAdmin, false);
  const crew = resolveMembership({ uid: "c1", profile: { role: "labourer", tenantId: "acme" } });
  assert.equal(crew.canSeeMoney, false);
  const supervisor = resolveMembership({ uid: "s1", profile: { role: "supervisor", tenantId: "acme" } });
  assert.equal(supervisor.canSeeMoney, true);
});

test("missing trade, including Heartwood and the test company, reads as earthworks", () => {
  for (const companyId of ["", ...LAZY_EARTHWORKS_IDS, "someone-else"]) {
    const setup = resolveCompanySetup({ companyId }, null);
    assert.equal(setup.trade, DEFAULT_TRADE, companyId);
    assert.deepEqual(Object.keys(readyJobTypeMap(setup)), ["spoil", "backslab", "waterproof", "clean", "other"]);
  }
  const tiling = resolveCompanySetup({ companyId: "tile-co", trade: "tiling" }, null);
  assert.equal(tiling.trade, "tiling");
  assert.equal(readyJobTypeMap(tiling) && Object.keys(readyJobTypeMap(tiling)).length, 0);
  assert.equal(quotePack("tiling").ready, false);
  assert.equal(quotePack("tiling").soon, "Quote pack coming soon");
});

test("every preloaded title maps to the permission level named in the sprint", () => {
  assert.equal(TRADES.length, 8);
  const counts = {};
  for (const trade of TRADES) {
    const titles = defaultTitles([trade.id]);
    assert.ok(titles.length >= 5, trade.id);
    for (const row of titles) {
      assert.equal(row.level, levelForTitleName(row.name), row.name);
      counts[row.level] = (counts[row.level] || 0) + 1;
    }
  }
  const earth = defaultTitles(["earthworks"]).map(t => [t.name, t.level]);
  assert.deepEqual(earth, [
    ["Operations manager", "manager"],
    ["Project manager", "manager"],
    ["Leading hand", "supervisor"],
    ["Operator", "operator"],
    ["Excavator operator", "operator"],
    ["Skid-steer operator", "operator"],
    ["Truck driver", "operator"],
    ["Labourer", "labourer"],
    ["Admin", "admin"],
  ]);
  assert.equal(levelForTitleName("Leading tiler"), "supervisor");
  assert.equal(levelForTitleName("Licensed electrician"), "operator");
  assert.equal(levelForTitleName("Apprentice plumber"), "labourer");
  assert.equal(levelForTitleName("Electrical trades assistant"), "labourer");
  assert.ok(counts.manager && counts.labourer && counts.operator);
});

test("a company can add, rename and remove titles without dropping the permission level by accident", () => {
  let titles = defaultTitles(["fencing"]);
  const added = addTitle(titles, { name: "Site clerk", level: "supervisor", trade: "fencing" });
  assert.equal(added.ok, true);
  titles = added.titles;
  assert.equal(titles.at(-1).custom, true);
  assert.equal(titles.at(-1).level, "supervisor");
  const renamed = renameTitle(titles, titles.at(-1).id, "Office clerk");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.titles.at(-1).level, "supervisor");
  const leveled = setTitleLevel(renamed.titles, renamed.titles.at(-1).id, "manager");
  assert.equal(leveled.titles.at(-1).level, "manager");
  const removed = removeTitle(leveled.titles, leveled.titles.at(-1).id);
  assert.equal(removed.ok, true);
  assert.equal(removed.titles.some(t => t.name === "Office clerk"), false);
  assert.equal(addTitle(removed.titles, { name: "Fencer", level: "operator" }).reason, "duplicate");
});

test("another trade is additive and only earthworks is a ready quote pack", () => {
  const setup = resolveCompanySetup({ trade: "carpentry" }, { extraTrades: ["earthworks", "carpentry", "nope"] });
  assert.deepEqual(setup.enabled, ["carpentry", "earthworks"]);
  assert.equal(quotePack("earthworks").ready, true);
  assert.equal(quotePack("earthworks").wizard, "plant");
  assert.deepEqual(quotePack("earthworks").templates.map(t => t.id), ["truck_skid", "truck_excavator", "truck_skid_excavator", "excavator"]);
  for (const trade of TRADES) {
    if (trade.id !== "earthworks") assert.equal(QUOTE_PACKS[trade.id].ready, false, trade.id);
  }
  const types = readyJobTypeMap(setup);
  assert.deepEqual(Object.keys(types), ["spoil", "backslab", "waterproof", "clean", "other"]);
});

test("measure helpers do area, volume, linear metre and waste, and do not invent a mix", () => {
  assert.deepEqual(measureQty({ measure: "area", length: 5, width: 2 }), { ok: true, qty: 10, base: 10, wastePct: 0, unit: "m2" });
  assert.equal(measureQty({ measure: "volume", length: 2, width: 3, depth: 0.5, wastePct: 10 }).qty, 3.3);
  assert.equal(measureQty({ measure: "linear", length: 12, wastePct: 5 }).qty, 12.6);
  assert.equal(measureQty({ measure: "volume", length: 1, width: 1 }).ok, false);
  assert.equal(normalizeTrade("Earthworks"), "earthworks");
  assert.equal(normalizeTrade("not-a-trade"), "");
  assert.equal(normalizeTrade("plumbing"), "plumbing");
});

test("skill tags are free text, trimmed and informational", () => {
  assert.deepEqual(sanitizeSkills([" White card ", "white card", "HR licence", "<script>", ""]), ["White card", "HR licence"]);
});

test("earthworks calculator helpers do not change the plant quote total", () => {
  const rates = {
    travelPerKm: 2, materialPerUnit: 3, tipPerLoad: 4, labourerRate: 45, labourerUnit: "hour",
    machineRates: { truck: { rate: 100, unit: "hour" }, skid: { rate: 80, unit: "hour" }, excavator: { rate: 120, unit: "hour" } },
  };
  const q = calcQuote({ hoursOnSite: 2, machines: ["truck", "skid"], includeLabourer: false, travelKm: 0, materialQty: 0, tipLoads: 0 }, rates);
  assert.equal(q.totalEx, 2 * 100 + 2 * 80);
});
