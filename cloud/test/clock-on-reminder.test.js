import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canToggleClockOnReminder, receivesClockOnReminder, staffViewHtml } from "../../app/features/staff-invites.js";
import { notifyPanelHtml } from "../../app/features/push-logic.js";
import {
  CLOCK_ON_BODY, CLOCK_ON_TITLE, clockOnOpenUrl, clockOnReminderId, clockOnRole, clockedOnAlready,
  companyReminderBlock, companyTimeZone, dispatchClockOnReminders, inClockOnWindow, leaveSkipsClockOn,
  reminderCompanies, selectClockOnReminders, weekStartOf,
} from "../functions/clock-on-reminder.js";

const MONDAY_630_BRISBANE = new Date("2026-11-08T20:30:00Z");
const SATURDAY_630_BRISBANE = new Date("2026-11-13T20:30:00Z");
const SUNDAY_630_BRISBANE = new Date("2026-11-14T20:30:00Z");
const PERTH_630 = new Date("2026-11-08T22:30:00Z");
const ADELAIDE_630 = new Date("2026-11-08T20:00:00Z");
const DATE = "2026-11-09";
const TOKEN = "fcm-token-value-0123456789-clock";

function person(uid, role, extra = {}) {
  return {
    uid,
    profile: extra.profile || { role, name: uid, companyId: extra.companyId || "heartwood" },
    muteClockOnReminder: extra.muteClockOnReminder === true,
    tokens: extra.tokens === undefined ? [{
      id: "t-" + uid,
      token: TOKEN + "-" + uid,
      companyId: extra.companyId || "heartwood",
      origin: extra.origin || "https://jobs.heartwoodew.com",
    }] : extra.tokens,
  };
}

function openEntry(date, status = "open") {
  return {
    entries: {
      e1: { source: "clock", status, date, id: "e1" },
    },
  };
}

test("weekday window follows the company timezone and defaults to Brisbane", () => {
  assert.equal(companyTimeZone({}), "Australia/Brisbane");
  assert.equal(companyTimeZone({ timezone: "  " }), "Australia/Brisbane");
  assert.equal(companyTimeZone({ timeZone: "Australia/Perth" }), "Australia/Perth");
  assert.equal(companyTimeZone({ timezone: "Not/A Zone" }), "Australia/Brisbane");
  assert.equal(companyTimeZone({ timezone: "Australia/Adelaide" }), "Australia/Adelaide");

  const brisbane = inClockOnWindow(MONDAY_630_BRISBANE, "Australia/Brisbane");
  assert.equal(brisbane && brisbane.date, DATE);
  assert.equal(brisbane && brisbane.weekday, "Mon");
  assert.equal(inClockOnWindow(SATURDAY_630_BRISBANE, "Australia/Brisbane"), null);
  assert.equal(inClockOnWindow(SUNDAY_630_BRISBANE, "Australia/Brisbane"), null);
  assert.equal(inClockOnWindow(new Date("2026-11-12T20:30:00Z"), "Australia/Brisbane").weekday, "Fri");
  assert.equal(inClockOnWindow(new Date("2026-11-08T20:29:00Z"), "Australia/Brisbane"), null);
  assert.equal(inClockOnWindow(new Date("2026-11-08T21:00:00Z"), "Australia/Brisbane"), null);

  assert.equal(inClockOnWindow(MONDAY_630_BRISBANE, "Australia/Perth"), null);
  assert.ok(inClockOnWindow(PERTH_630, "Australia/Perth"));
  assert.equal(inClockOnWindow(PERTH_630, "Australia/Brisbane"), null);
  assert.equal(inClockOnWindow(ADELAIDE_630, "Australia/Adelaide").date, DATE);
  assert.equal(weekStartOf(DATE), "2026-11-09");
  assert.equal(weekStartOf("2026-11-11"), "2026-11-09");
});

test("test, paused and expired companies are left out, and only the local 6:30 slot is due", () => {
  const now = MONDAY_630_BRISBANE;
  assert.equal(companyReminderBlock({ isTest: true, status: "active" }, "acme", now), "test");
  assert.equal(companyReminderBlock({ status: "archived", plan: "paid", billing: { status: "active" } }, "old", now), "archived");
  assert.equal(companyReminderBlock({ ownerPaused: true, plan: "paid", billing: { status: "active" } }, "held", now), "paused");
  assert.equal(companyReminderBlock({ plan: "trial", status: "active", trialEndsAt: "2026-11-01T00:00:00Z" }, "ended", now), "expired");
  assert.equal(companyReminderBlock({ plan: "friend", friendEndsAt: "2026-11-01T00:00:00Z" }, "pal", now), "expired");
  assert.equal(companyReminderBlock({ plan: "paid", billing: { status: "canceled" } }, "late", now), "paused");
  assert.equal(companyReminderBlock({ plan: "paid", billing: { status: "active" } }, "pay", now), "");
  assert.equal(companyReminderBlock({ plan: "trial", status: "active", trialEndsAt: "2026-12-01T00:00:00Z" }, "open", now), "");
  assert.equal(companyReminderBlock(null, "heartwood", now), "");

  const due = reminderCompanies([
    { id: "acme", isTest: true, status: "active", timezone: "Australia/Brisbane" },
    { id: "oldco", status: "archived", timezone: "Australia/Brisbane" },
    { id: "ended", plan: "trial", status: "active", trialEndsAt: "2026-11-01T00:00:00Z", timezone: "Australia/Brisbane" },
    { id: "bravo", status: "active", plan: "paid", billing: { status: "active" }, timezone: "Australia/Brisbane", name: "Bravo" },
    { id: "perth", status: "active", plan: "paid", billing: { status: "active" }, timezone: "Australia/Perth" },
  ], now);
  assert.deepEqual(due.map(company => company.id), ["heartwood", "bravo"]);
  assert.equal(reminderCompanies([{ id: "perth", plan: "paid", billing: { status: "active" }, timezone: "Australia/Perth" }], PERTH_630).map(c => c.id).includes("perth"), true);
  assert.equal(reminderCompanies([], SATURDAY_630_BRISBANE).length, 0);
});

test("selection skips mute, anyone already clocked on, leave, other roles, and people with no token", () => {
  const people = [
    person("op1", "operator"),
    person("lab", "labourer"),
    person("sue", "supervisor"),
    person("mgr", "manager"),
    person("ada", "admin"),
    person("muted", "operator", { muteClockOnReminder: true }),
    person("off", "operator", { muteClockOnReminder: false }),
    person("notoken", "operator", { tokens: [] }),
    person("short", "operator", { tokens: [{ id: "x", token: "short", companyId: "heartwood", origin: "https://jobs.heartwoodew.com" }] }),
    person("other", "operator", { profile: { role: "operator", companyId: "bravo" }, companyId: "heartwood" }),
    person("yest", "operator"),
  ];
  const sheets = {
    op1: openEntry(DATE, "open"),
    lab: openEntry(DATE, "closed"),
    sue: openEntry(DATE, "break"),
    yest: openEntry("2026-11-08", "open"),
  };
  const live = { mgr: { uid: "mgr", companyId: "heartwood", clockedOn: true, sharing: "off" } };
  const leaves = [
    { uid: "off", status: "approved", companyId: "heartwood", start: DATE, end: DATE, startHalf: "", endHalf: "" },
  ];
  const picked = selectClockOnReminders({
    companyId: "heartwood", date: DATE, timeZone: "Australia/Brisbane", now: MONDAY_630_BRISBANE,
    people, sheets, live, leaves,
  });
  assert.deepEqual(picked.map(row => row.uid), ["lab", "yest"]);
  assert.equal(picked.find(row => row.uid === "lab").messages[0].notification.title, CLOCK_ON_TITLE);
  const lab = picked.find(row => row.uid === "lab");
  assert.equal(lab.messages[0].notification.body, CLOCK_ON_BODY);
  assert.equal(lab.messages[0].data.body, CLOCK_ON_BODY);
  assert.equal(lab.messages[0].webpush.fcmOptions.link, "https://jobs.heartwoodew.com/app/?open=timesheet");
  assert.equal(lab.messages[0].data.kind, "clock-on");
  assert.equal(lab.id, clockOnReminderId("heartwood", DATE, "lab"));
  assert.equal(JSON.stringify(lab.messages).includes(TOKEN), true);

  const open = selectClockOnReminders({
    companyId: "heartwood", timeZone: "Australia/Brisbane", now: MONDAY_630_BRISBANE,
    people: [person("op1", "operator")],
    sheets: { op1: openEntry(DATE, "open") },
  });
  assert.equal(open.length, 0);
  assert.equal(clockedOnAlready(openEntry(DATE, "open"), DATE, null, "heartwood", "op1"), true);
  assert.equal(clockedOnAlready(openEntry(DATE, "break"), DATE, null, "heartwood", "op1"), true);
  assert.equal(clockedOnAlready(openEntry(DATE, "closed"), DATE, { clockedOn: false }, "heartwood", "op1"), false);
  assert.equal(clockedOnAlready(null, DATE, { clockedOn: true, companyId: "bravo" }, "heartwood", "op1"), false);
  assert.equal(clockedOnAlready(null, DATE, { clockedOn: true, companyId: "heartwood", uid: "op1" }, "heartwood", "op1"), true);

  assert.equal(leaveSkipsClockOn([{ uid: "a", status: "approved", start: DATE, end: DATE, startHalf: "am", endHalf: "am" }], { uid: "a", companyId: "heartwood" }, DATE), true);
  assert.equal(leaveSkipsClockOn([{ uid: "a", status: "approved", start: DATE, end: DATE, startHalf: "pm", endHalf: "pm" }], { uid: "a", companyId: "heartwood" }, DATE), false);
  assert.equal(leaveSkipsClockOn([{ uid: "a", status: "pending", start: DATE, end: DATE }], { uid: "a", companyId: "heartwood" }, DATE), false);
  assert.equal(leaveSkipsClockOn([{ uid: "b", status: "approved", start: DATE, end: "2026-11-10", startHalf: "pm" }], { uid: "b", companyId: "heartwood" }, DATE), false);
  assert.equal(leaveSkipsClockOn([{ uid: "b", status: "approved", start: "2026-11-08", end: DATE, endHalf: "am" }], { uid: "b", companyId: "heartwood" }, DATE), true);
  assert.equal(selectClockOnReminders({
    companyId: "heartwood", timeZone: "Australia/Brisbane", now: SATURDAY_630_BRISBANE,
    people: [person("op1", "operator")],
  }).length, 0);
  assert.equal(clockOnRole({ role: "admin" }), "");
  assert.equal(clockOnRole({ role: "operator" }), "operator");
  assert.equal(clockOnOpenUrl("https://evil.example", "bravo"), "https://app.callupapp.com.au/app/?open=timesheet");
});

test("several companies each get their own 6:30, once, and a stale token is dropped without logging it", async () => {
  const secret = "fcm-SECRET-TOKEN-0123456789-do-not-log";
  const claimed = new Set();
  const sent = [];
  const dropped = [];
  const loaded = [];
  const lines = [];
  const write = { log: (...args) => lines.push(args.join(" ")), error: (...args) => lines.push(args.join(" ")) };
  const original = { log: console.log, error: console.error };
  console.log = write.log;
  console.error = write.error;
  const companies = [
    { id: "heartwood", status: "active" },
    { id: "bravo", status: "active", plan: "paid", billing: { status: "active" }, timezone: "Australia/Perth" },
    { id: "acme", isTest: true, status: "active", timezone: "Australia/Brisbane" },
    { id: "ended", plan: "trial", trialEndsAt: "2026-10-01T00:00:00Z", timezone: "Australia/Brisbane" },
  ];
  const run = () => dispatchClockOnReminders({
    now: PERTH_630,
    loadCompanies: async () => companies,
    loadPeople: async (companyId) => {
      loaded.push(companyId);
      if (companyId === "heartwood") return [person("hw", "operator", { tokens: [{ id: "dead", token: secret, companyId: "heartwood", origin: "https://jobs.heartwoodew.com" }] })];
      if (companyId === "bravo") return [
        person("bo", "supervisor", { companyId: "bravo", origin: "https://app.callupapp.com.au" }),
        person("quiet", "operator", { companyId: "bravo", muteClockOnReminder: true, origin: "https://app.callupapp.com.au" }),
      ];
      return [person("tester", "operator", { companyId: companyId })];
    },
    loadSheet: async () => null,
    loadLive: async () => null,
    loadLeave: async () => [],
    claim: async (reminder) => {
      if (claimed.has(reminder.id)) return false;
      claimed.add(reminder.id);
      return true;
    },
    sendEach: async (messages) => {
      sent.push(messages);
      if (messages[0].token === secret) {
        return { responses: [{ success: false, error: { code: "messaging/registration-token-not-registered", message: "token " + secret } }] };
      }
      return { responses: messages.map(() => ({ success: true })) };
    },
    deleteToken: async (target) => dropped.push(target),
  });
  try {
    const first = await run();
    assert.deepEqual(first.companies, ["bravo"]);
    assert.deepEqual(loaded, ["bravo"]);
    assert.equal(first.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0].notification.title, CLOCK_ON_TITLE);
    assert.equal(sent[0][0].webpush.fcmOptions.link, "https://app.callupapp.com.au/app/?open=timesheet");
    assert.equal(sent[0].some(message => message.token && String(message.token).includes("quiet")), false);

    const second = await run();
    assert.equal(second.sent, 0);
    assert.equal(second.skipped, 1);
    assert.equal(sent.length, 1);

    const monday = await dispatchClockOnReminders({
      now: MONDAY_630_BRISBANE,
      loadCompanies: async () => companies,
      loadPeople: async (companyId) => {
        if (companyId === "heartwood") return [person("hw", "operator", { tokens: [{ id: "dead", token: secret, companyId: "heartwood", origin: "https://jobs.heartwoodew.com" }] })];
        if (companyId === "bravo") return [];
        return [];
      },
      loadSheet: async (uid, week) => {
        assert.equal(uid, "hw");
        assert.equal(week, weekStartOf(DATE));
        return null;
      },
      loadLive: async () => ({ clockedOn: false }),
      loadLeave: async () => [],
      claim: async () => true,
      sendEach: async (messages) => {
        sent.push(messages);
        return { responses: [{ success: false, error: { code: "messaging/registration-token-not-registered", message: secret } }] };
      },
      deleteToken: async (target) => dropped.push({ tokenId: target.tokenId, uid: target.uid }),
    });
    assert.deepEqual(monday.companies, ["heartwood"]);
    assert.equal(monday.dropped, 1);
    assert.equal(dropped.at(-1).tokenId, "dead");
    assert.equal(dropped.at(-1).uid, "hw");
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
  const log = lines.join("\n");
  assert.match(log, /clock on/);
  assert.match(log, /targets/);
  assert.match(log, /sent/);
  assert.match(log, /dropped/);
  assert.match(log, /messaging\/registration-token-not-registered/);
  assert.equal(log.includes(secret), false);
});

test("the staff screen and notification settings can turn the default off", () => {
  assert.equal(receivesClockOnReminder("operator"), true);
  assert.equal(receivesClockOnReminder("supervisor"), true);
  assert.equal(receivesClockOnReminder("manager"), true);
  assert.equal(receivesClockOnReminder("labourer"), true);
  assert.equal(receivesClockOnReminder("admin"), false);
  assert.equal(canToggleClockOnReminder({ role: "admin", cloudProfile: { role: "admin" } }), true);
  assert.equal(canToggleClockOnReminder({ role: "admin", cloudProfile: { role: "operator" } }), true);
  assert.equal(canToggleClockOnReminder({ role: "admin", cloudProfile: { role: "manager" } }), false);
  const html = staffViewHtml([], {
    companyId: "bravo",
    origin: "https://app.callupapp.com.au",
    clockOnAdmin: true,
    clockMutes: { lee: true },
    logins: [
      { uid: "bo", name: "Bo", email: "bo@bravo.test", role: "operator", companyId: "bravo" },
      { uid: "lee", name: "Lee", email: "lee@bravo.test", role: "supervisor", companyId: "bravo" },
      { uid: "bea", name: "Bea", email: "bea@bravo.test", role: "admin", companyId: "bravo" },
    ],
  });
  assert.match(html, /data-clock-on="bo"[^>]*checked/);
  assert.match(html, /data-clock-on="lee"/);
  assert.doesNotMatch(html.slice(html.indexOf('data-clock-on="lee"'), html.indexOf('data-clock-on="lee"') + 40), /checked/);
  assert.doesNotMatch(html.slice(html.indexOf('data-staff-uid="bea"'), html.indexOf("</article>", html.indexOf('data-staff-uid="bea"'))), /data-clock-on/);
  const hidden = staffViewHtml([], {
    companyId: "bravo",
    clockOnAdmin: false,
    logins: [{ uid: "bo", name: "Bo", email: "bo@bravo.test", role: "operator", companyId: "bravo" }],
  });
  assert.doesNotMatch(hidden, /data-clock-on/);
  const panel = notifyPanelHtml({ muteClockOnReminder: false, muteChat: false, muteDaily: false });
  assert.match(panel, /Mute Clock On reminder/);
  assert.match(panel, /data-mute-clock/);
  assert.doesNotMatch(panel.slice(panel.indexOf("data-mute-clock"), panel.indexOf("data-mute-clock") + 80), /checked/);
  assert.match(notifyPanelHtml({ muteClockOnReminder: true }), /data-mute-clock checked/);
});

test("the schedule, rules and service worker are wired for a reviewed deploy", () => {
  const push = readFileSync(new URL("../functions/clock-on-push.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(push, /schedule: "\*\/15 \* \* \* \*"/);
  assert.match(push, /timeZone: "UTC"/);
  assert.match(push, /australia-southeast1/);
  assert.match(push, /clockOnReminders/);
  assert.match(push, /NODE_TEST_CONTEXT/);
  assert.match(index, /export \{ clockOnReminderPush \}/);
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  assert.match(rules, /muteClockOnReminder/);
  assert.doesNotMatch(rules, /match \/clockOnReminders\/\{id\}/);
  assert.match(rules, /match \/dailyJobDigest\/\{id\}/);
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v168-profile-lock/);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /data-clock-on/);
  assert.match(app, /open=timesheet|kind === "timesheet"/);
});
