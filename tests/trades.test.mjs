import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRADE, LAZY_EARTHWORKS_IDS, TRADES, QUOTE_PACKS,
  addTitle, companyTradesDoc, defaultTitles, expandTradeId, filterTrades, levelForTitleName, measureQty, normalizeTrade, quotePack, quoteTradeSwitchHtml,
  chooseTitleLevel, readTradeList, readyJobTypeMap, removeTitle, renameTitle, resolveCompanySetup, sanitizeSkills, setTitleLevel,
  signupTradesHtml, tradeSettingsHtml, tradeToolsHtml,
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
    assert.deepEqual(setup.enabled, [DEFAULT_TRADE], companyId);
    assert.equal(setup.trade, DEFAULT_TRADE, companyId);
    assert.deepEqual(Object.keys(readyJobTypeMap(setup)), ["spoil", "backslab", "waterproof", "clean", "other"]);
  }
  const tiling = resolveCompanySetup({ companyId: "tile-co", trade: "tiling" }, null);
  assert.deepEqual(tiling.enabled, ["tiling"]);
  assert.deepEqual(Object.keys(readyJobTypeMap(tiling)), ["ti-floor", "ti-wall", "ti-wet", "ti-waterproof", "ti-labour", "ti-other"]);
  assert.equal(quotePack("tiling").ready, true);
  assert.equal(quotePack("tiling").wizard, "measure");
  assert.equal(quotePack("tiling").soon, "");
});

test("a company can store several trades, and the old single trade field still reads", () => {
  const many = resolveCompanySetup({ trades: ["plumbing", "tiling", "plumbing"], trade: "earthworks" }, null);
  assert.deepEqual(many.enabled, ["plumbing", "tiling"]);
  assert.equal(many.trade, "plumbing");
  const legacy = resolveCompanySetup({ trade: "fencing" }, { extraTrades: ["carpentry", "fencing", "nope"] });
  assert.deepEqual(legacy.enabled, ["fencing", "carpentry"]);
  assert.deepEqual(readTradeList({}, {}), ["earthworks"]);
  const names = defaultTitles(["earthworks", "landscaping"]).map(row => row.name);
  assert.equal(names.filter(name => name === "Labourer").length, 1);
  assert.equal(names.filter(name => name === "Operations manager").length, 1);
  assert.ok(names.includes("Landscaper"));
  assert.ok(names.includes("Excavator operator"));
});

test("a shared title keeps the lower level unless the primary mapping is already that low", () => {
  const lower = chooseTitleLevel("Leading hand", [
    { trade: "earthworks", level: "manager" },
    { trade: "landscaping", level: "supervisor" },
  ]);
  assert.equal(lower.level, "supervisor");
  assert.match(lower.levelNote, /not applied/);
  const safe = chooseTitleLevel("Labourer", [
    { trade: "fencing", level: "labourer" },
    { trade: "carpentry", level: "operator" },
  ]);
  assert.equal(safe.level, "labourer");
  assert.match(safe.levelNote, /primary/);
  assert.equal(chooseTitleLevel("Fencer", [{ trade: "fencing", level: "operator" }]).levelNote, "");
});

test("every preloaded title maps to the permission level named in the sprint", () => {
  assert.equal(TRADES.length, 17);
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
  assert.equal(levelForTitleName("Manager"), "manager");
  assert.equal(levelForTitleName("Supervisor"), "supervisor");
  assert.equal(levelForTitleName("Concrete cutter / saw operator"), "operator");
  assert.equal(levelForTitleName("Core driller"), "operator");
  assert.equal(levelForTitleName("Apprentice"), "labourer");
  const cutting = defaultTitles(["concrete-cutting"]).map(t => [t.name, t.level]);
  assert.deepEqual(cutting, [
    ["Admin", "admin"],
    ["Manager", "manager"],
    ["Supervisor", "supervisor"],
    ["Concrete cutter / saw operator", "operator"],
    ["Core driller", "operator"],
    ["Labourer", "labourer"],
    ["Apprentice", "labourer"],
  ]);
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

test("another trade is additive and earthworks stays the plant pack", () => {
  const setup = resolveCompanySetup({ trade: "carpentry" }, { extraTrades: ["earthworks", "carpentry", "nope"] });
  assert.deepEqual(setup.enabled, ["carpentry", "earthworks"]);
  assert.equal(quotePack("earthworks").ready, true);
  assert.equal(quotePack("earthworks").wizard, "plant");
  assert.deepEqual(quotePack("earthworks").templates.map(t => t.id), ["truck_skid", "truck_excavator", "truck_skid_excavator", "excavator"]);
  for (const id of ["landscaping", "concreting", "fencing", "carpentry", "tiling", "plumbing", "electrical", "concrete-cutting"]) {
    assert.equal(QUOTE_PACKS[id].ready, true, id);
    assert.equal(QUOTE_PACKS[id].wizard, "measure", id);
  }
  const types = readyJobTypeMap(setup);
  assert.deepEqual(Object.keys(types), ["ca-frame", "ca-fitout", "ca-deck", "ca-wet", "ca-labour", "ca-other", "spoil", "backslab", "waterproof", "clean", "other"]);
});

test("every trade except the plant wizard lands in a measured pack", () => {
  for (const id of ["landscaping", "concreting", "fencing", "carpentry", "tiling", "plumbing", "electrical", "concrete-cutting"]) {
    const setup = resolveCompanySetup({ trades: [id] }, null);
    assert.equal(setup.trade, id);
    assert.ok(Object.keys(readyJobTypeMap(setup)).length > 0, id);
    const html = quoteTradeSwitchHtml(setup, id);
    assert.match(html, new RegExp(quotePack(id).label));
    assert.doesNotMatch(html, /coming soon/);
  }
  const mixed = resolveCompanySetup({ trades: ["carpentry", "landscaping"] }, null);
  const switcher = quoteTradeSwitchHtml(mixed, "carpentry");
  assert.match(switcher, /Landscaping/);
  assert.match(switcher, /Carpentry/);
  const tools = tradeToolsHtml(mixed, { canEdit: true, focus: "landscaping" });
  assert.match(tools, /value="concreting"/);
  assert.match(tools, /value="fencing"/);
  assert.match(tools, /value="earthworks"/);
  assert.match(tools, /value="plumbing"/);
  assert.match(tools, /value="tiling"/);
  assert.match(tools, /value="electrical"/);
  assert.match(tools, /value="concrete-cutting"/);
  const settings = tradeSettingsHtml(["landscaping"], { canEdit: true });
  assert.match(settings, /Quote pack ready/);
  assert.doesNotMatch(settings, /coming soon/);
  const signup = signupTradesHtml(["carpentry"]);
  assert.match(signup, /value="carpentry"[^>]*> Carpentry<\/label>/);
  assert.match(signup, /value="tiling"[^>]*> Tiling<\/label>/);
  assert.match(signup, /value="concrete-cutting"[^>]*> Concrete Cutting<\/label>/);
  assert.doesNotMatch(signup, /coming soon/);
  const picked = signupTradesHtml(["concrete-cutting", "plumbing"]);
  assert.match(picked, /value="concrete-cutting" checked/);
  assert.match(picked, /value="plumbing" checked/);
  const cutting = resolveCompanySetup({ trades: ["concrete-cutting", "plumbing", "earthworks"] }, null);
  assert.deepEqual(cutting.enabled, ["concrete-cutting", "plumbing", "earthworks"]);
  assert.equal(quotePack("concrete-cutting").label, "Concrete Cutting");
  assert.deepEqual(quotePack("concrete-cutting").jobTypes.map(([, label]) => label), [
    "Floor sawing", "Wall sawing", "Core drilling", "Wire sawing", "Hand/ring sawing",
    "Control joint cutting", "Crack chasing", "Concrete removal & breaking", "Floor grinding", "Scanning/GPR",
  ]);
  const all = TRADES.map(t => t.id);
  const doc = companyTradesDoc("cut-co", all, "u");
  assert.deepEqual(doc.trades, all);
  assert.equal(doc.trade, "earthworks");
  assert.equal(doc.extraTrades.length, all.length - 1);
  assert.ok(doc.extraTrades.includes("concrete-cutting"));
  assert.ok(doc.titles.length <= 80);
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

test("civil is its own trade and a stored traffic-civil company keeps both packs", () => {
  const civil = filterTrades("civil");
  assert.deepEqual(civil.map(row => row.id), ["civil-earthworks"]);
  assert.match(civil[0].label, /Civil/);
  assert.equal(filterTrades("traffic").some(row => row.id === "traffic-control"), true);
  assert.equal(filterTrades("CIVIL").some(row => row.id === "earthworks"), false);
  const html = signupTradesHtml([]);
  assert.match(html, /data-trade-search/);
  assert.match(html, /Civil and earthworks/);
  assert.match(html, /value="traffic-control"/);
  assert.doesNotMatch(html, /value="traffic-civil"/);
  assert.deepEqual(expandTradeId("traffic-civil"), ["traffic-control", "civil-earthworks"]);
  const heartwood = resolveCompanySetup({ companyId: "heartwood" }, null);
  assert.deepEqual(heartwood.enabled, ["earthworks"]);
  const stored = resolveCompanySetup({ companyId: "heartwood", trades: ["traffic-civil"] }, {
    trades: ["traffic-civil"],
    titles: [{ id: "traffic-civil:traffic-controller", name: "Traffic controller", level: "operator", trade: "traffic-civil", custom: false }],
    checklists: [{ id: "tc-prestart", label: "Plant prestart done before the shift", jobTypes: ["tc-traffic"], custom: false, trade: "traffic-civil" }],
    photoSteps: [{ id: "tc-setup", label: "Site setup photo", jobTypes: ["tc-traffic"], required: true, custom: false, trade: "traffic-civil" }],
  });
  assert.deepEqual(stored.enabled, ["traffic-control", "civil-earthworks"]);
  assert.equal(stored.titles.some(row => row.name === "Traffic controller" && row.trade === "traffic-control"), true);
  assert.equal(stored.checklists.some(row => row.id === "tc-prestart"), true);
  assert.equal(stored.photoSteps.some(row => row.id === "tc-setup"), true);
  assert.equal(stored.checklists.some(row => row.trade === "civil-earthworks"), true);
  const legacy = quotePack("traffic-civil");
  assert.equal(legacy.ready, true);
  assert.equal(legacy.label, "Traffic control and civil");
  assert.ok(legacy.lineItems.some(row => row.label === "Civil works"));
  assert.ok(legacy.lineItems.some(row => row.label === "Traffic controller"));
  assert.equal(quotePack("civil-earthworks").label, "Civil and earthworks");
  assert.equal(quotePack("traffic-control").label, "Traffic control");
  const doc = companyTradesDoc("civil-co", ["traffic-civil"], "u");
  assert.deepEqual(doc.trades, ["traffic-control", "civil-earthworks"]);
  assert.equal(doc.trade, "traffic-control");
});
