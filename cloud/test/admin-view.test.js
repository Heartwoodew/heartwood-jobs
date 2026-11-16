// Platform owner: Back to master page on the Admin view banner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearSavedOrg, orgSettings, saveOrgSettings, setActiveCompany } from "../../app/org-settings.js";
import {
  ADMIN_VIEW_PARAM, IN_COMPANY_VIEW_KEY, RETURN_MASTER_KEY,
  adminViewBannerHtml, bootCompanyView, clearedCompanySession,
  companyHistoryState, historyStepOnEnter, historyStepOnMasterReturn,
  masterHistoryState, takeReturnMasterFlag, urlMarksCompanyView, viewingAnotherCompany,
  withCompanyViewParam,
} from "../../app/features/company-ui.js";

const APP = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../app/styles.css", import.meta.url), "utf8");

test("the master button is only on the Admin view banner while the platform owner is in a company", () => {
  assert.equal(viewingAnotherCompany({ platformOwner: false, sessionCompanyId: "bobs" }), false);
  assert.equal(viewingAnotherCompany({ platformOwner: true, sessionCompanyId: "  " }), false);
  assert.equal(viewingAnotherCompany({ platformOwner: true, sessionCompanyId: "bobs" }), true);

  const stranger = adminViewBannerHtml({ platformOwner: false, sessionCompanyId: "bobs", companyName: "Bobs", operatorAdmin: true });
  assert.equal(stranger, `<button class="mback adminback" id="toadmin" type="button">Admin view</button>`);
  assert.doesNotMatch(stranger, /backmaster/);

  const ownOffice = adminViewBannerHtml({ platformOwner: true, sessionCompanyId: "", companyName: "Heartwood Earthworx", operatorAdmin: true });
  assert.equal(ownOffice, stranger);
  assert.equal(adminViewBannerHtml({ platformOwner: true, sessionCompanyId: "", operatorAdmin: false }), "");

  const desktop = adminViewBannerHtml({ platformOwner: true, sessionCompanyId: "bobs", companyName: "Bobs", operatorAdmin: false });
  assert.match(desktop, /class="adminview-banner"/);
  assert.match(desktop, /Admin view · Bobs/);
  assert.match(desktop, /id="backmaster">Back to master page</);
  assert.doesNotMatch(desktop, /id="toadmin"/);

  const phone = adminViewBannerHtml({ platformOwner: true, sessionCompanyId: "bobs", companyName: "Bobs", operatorAdmin: true });
  assert.match(phone, /class="adminview-banner"/);
  assert.match(phone, /id="toadmin"[^>]*>Admin view</);
  assert.match(phone, /id="backmaster">Back to master page</);

  const nasty = adminViewBannerHtml({ platformOwner: true, sessionCompanyId: "bobs", companyName: `Bobs <img alt="x">`, operatorAdmin: false });
  assert.match(nasty, /Admin view · Bobs &lt;img alt=&quot;x&quot;&gt;/);
  assert.doesNotMatch(nasty, /<img/);
});

test("the banner is dark brown and the button stays a 44px target on a phone", () => {
  assert.match(CSS, /\.adminview-banner\{[^}]*background:#3b2a1a/);
  assert.match(CSS, /\.adminview-back\{[^}]*min-height:44px/);
  assert.match(CSS, /@media \(max-width:760px\)\{[^}]*\.adminview-back[^}]*min-height:44px/);
  assert.match(CSS, /body\.operator \.adminview-banner\{[^}]*background:#3b2a1a/);
});

test("leaving clears the session, the saved company name, and opens Master", () => {
  assert.deepEqual(clearedCompanySession(), { companyId: "" });
  const store = new Map();
  const storage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
  };
  globalThis.localStorage = storage;
  setActiveCompany(null);
  saveOrgSettings({ name: "Bobs" });
  assert.equal(orgSettings().name, "Bobs");
  clearSavedOrg();
  setActiveCompany(null);
  assert.equal(orgSettings().name, "Heartwood Earthworx");
  assert.equal(storage.getItem("callup.org.v1"), null);

  storage.setItem(RETURN_MASTER_KEY, "1");
  assert.equal(takeReturnMasterFlag(storage), true);
  assert.equal(storage.getItem(RETURN_MASTER_KEY), null);
  assert.equal(takeReturnMasterFlag(storage), false);
  const memory = {
    getItem() { throw new Error("private"); },
    removeItem() { throw new Error("private"); },
  };
  assert.equal(takeReturnMasterFlag(memory), false);
});

test("reload keeps the company view, and back or the button opens Master", () => {
  const stay = bootCompanyView({ platformOwner: true, sessionCompanyId: "bobs", urlMarked: true, navType: "reload" });
  assert.deepEqual(stay, { action: "stay", clearSession: false, companyId: "bobs" });
  const markedAgain = bootCompanyView({ platformOwner: true, sessionCompanyId: "bobs", urlMarked: false, navType: "reload" });
  assert.equal(markedAgain.action, "stay-and-mark");
  assert.equal(markedAgain.clearSession, false);
  const back = bootCompanyView({ platformOwner: true, sessionCompanyId: "bobs", urlMarked: false, navType: "back_forward" });
  assert.deepEqual(back, { action: "master", clearSession: true, companyId: "" });
  const button = bootCompanyView({ platformOwner: true, sessionCompanyId: "bobs", urlMarked: true, returnMaster: true });
  assert.deepEqual(button, { action: "master", clearSession: true, companyId: "" });
  const alreadyHome = bootCompanyView({ platformOwner: true, sessionCompanyId: "", urlMarked: false, returnMaster: true });
  assert.deepEqual(alreadyHome, { action: "master", clearSession: false, companyId: "" });
  const staff = bootCompanyView({ platformOwner: false, sessionCompanyId: "bobs", urlMarked: true, navType: "back_forward", returnMaster: true });
  assert.equal(staff.action, "ignore");
  const stray = bootCompanyView({ platformOwner: true, sessionCompanyId: "", urlMarked: true, navType: "navigate" });
  assert.equal(stray.action, "strip-mark");

  assert.equal(urlMarksCompanyView("?friend=bknepa4v&adminView=1"), true);
  assert.equal(urlMarksCompanyView("adminView=0"), false);
  const href = "https://app.callupapp.com.au/app/?friend=bknepa4v#jobs";
  const marked = withCompanyViewParam(href, true);
  assert.equal(marked, "/app/?friend=bknepa4v&adminView=1#jobs");
  assert.equal(withCompanyViewParam("https://app.callupapp.com.au" + marked, false), "/app/?friend=bknepa4v#jobs");
  assert.equal(ADMIN_VIEW_PARAM, "adminView");

  assert.deepEqual(historyStepOnEnter(null, "bobs"), { action: "push", state: companyHistoryState("bobs") });
  assert.equal(historyStepOnEnter(companyHistoryState("bobs"), "bobs").action, "keep");
  assert.equal(historyStepOnMasterReturn(companyHistoryState("bobs")).action, "replace");
  assert.deepEqual(historyStepOnMasterReturn(companyHistoryState("bobs")).state, masterHistoryState());
  assert.equal(historyStepOnMasterReturn(null).action, "push");
  assert.equal(IN_COMPANY_VIEW_KEY, "callup.inCompanyView");
});

test("the app wires the button, the reload, and the back button to the same exit", () => {
  const boot = APP.slice(APP.indexOf("me.testCompanyId = \"\";"), APP.indexOf("await loadCompanyBrand();"));
  assert.match(boot, /bootCompanyView\(/);
  assert.match(boot, /clearedCompanySession\(\)/);
  assert.match(boot, /clearSavedOrg\(\)/);
  assert.match(boot, /ui\.landOnMaster = true/);
  assert.match(boot, /history\.pushState\(companyHistoryState/);
  assert.match(APP, /if \(ui\.landOnMaster && me\.platformOwner\) ui\.view = "master"/);

  const exit = APP.slice(APP.indexOf("async function returnToMasterPage"), APP.indexOf("async function openTestCompany"));
  assert.match(exit, /RETURN_MASTER_KEY/);
  assert.match(exit, /clearedCompanySession\(\)/);
  assert.match(exit, /dropViewedCompanyState\(\)/);
  assert.match(exit, /location\.reload\(\)/);
  assert.match(exit, /historyStepOnMasterReturn/);
  assert.match(APP, /function dropViewedCompanyState\(\)[\s\S]*jobs = \[\]/);
  assert.match(APP, /function dropViewedCompanyState\(\)[\s\S]*clearSavedOrg\(\)/);
  assert.match(APP, /function dropViewedCompanyState\(\)[\s\S]*me\.testCompanyId = ""/);

  assert.match(APP, /const adminBack = \(\) => companyViewBanner\(\{ operator: true \}\)/);
  assert.match(APP, /return `\$\{companyViewBanner\(\)\}<div class="sm-layout/);
  assert.match(APP, /addEventListener\("popstate"/);
  assert.match(APP, /addEventListener\("pageshow"/);
  assert.match(APP, /returnToMasterPage\(\{ fromPop: true \}\)/);

  const admin = APP.slice(APP.indexOf("function renderAdmin"), APP.indexOf("async function dispatchMove"));
  assert.match(admin, /bindMasterReturn\(A\)/);
  const op = APP.slice(APP.indexOf("function bindOp"), APP.indexOf("function snapExists"));
  assert.match(op, /bindMasterReturn\(\$\("#app"\)\)/);
  const detail = APP.slice(APP.indexOf("function renderOpDetail"), APP.indexOf("const logEntry"));
  assert.match(detail, /companyViewBanner\(\)/);
  assert.match(detail, /bindMasterReturn\(\$\("#app"\)\)/);
  assert.match(APP, /openTestCompany[\s\S]*withCompanyViewParam\(location\.href, true\)/);
  assert.match(APP, /async function leavePausedSession\(\) \{\n  await returnToMasterPage\(\);\n\}/);
});
