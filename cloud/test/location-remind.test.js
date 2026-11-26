import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushTargetFromUrl } from "../../app/features/push-logic.js";
import { actionForCall, needsSignal } from "../../app/features/offline.js";
import { GPS_REMIND_BODY, GPS_REMIND_NONE, GPS_REMIND_SENT, locationRemindBannerHtml } from "../../app/features/live-location.js";
import { canRemindLocation, rosterShareState, staffViewHtml } from "../../app/features/staff-invites.js";
import {
  REMIND_BODY, REMIND_NO_DEVICE, REMIND_RATE, REMIND_SENT, REMIND_SHARING, REMIND_WINDOW_MS,
  canSendLocationReminder, companyIdOf, isSharingLocation, locationOpenUrl, remindLocationSharing,
  remindRateOk, reminderNotice, reminderPushes,
} from "../functions/location-remind.js";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const NOW = new Date("2026-11-23T01:00:00.000Z");
const TOKEN = "fcm-" + "x".repeat(40);

function user(role, companyId) {
  return { profile: { role, companyId, tenantId: companyId, name: role }, heartwoodGrant: false };
}

function deps(extra = {}) {
  const notices = [];
  const dropped = [];
  const sent = [];
  const base = {
    now: () => NOW,
    async getUser(uid) {
      return extra.users[uid] || { profile: null, heartwoodGrant: false };
    },
    async getLive(companyId, uid) {
      return (extra.live && extra.live[companyId + "/" + uid]) || null;
    },
    async claimNotice({ uid, companyId, now }) {
      const prev = extra.sentAt && extra.sentAt[uid];
      const decision = remindRateOk(prev, now);
      if (!decision.ok) return { ok: false };
      notices.push({ uid, ...reminderNotice(companyId, decision.at) });
      return { ok: true, at: decision.at };
    },
    async loadTokens(uid) {
      return (extra.tokens && extra.tokens[uid]) || [];
    },
    async sendEach(messages) {
      sent.push(...messages);
      if (extra.send) return extra.send(messages);
      return { responses: messages.map(() => ({ success: true })) };
    },
    async deleteToken(target) { dropped.push(target); },
    notices,
    dropped,
    sent,
  };
  return Object.assign(base, extra.override || {});
}

test("the reminder sentence is the push, the banner, and the admin replies", () => {
  assert.equal(REMIND_BODY, GPS_REMIND_BODY);
  assert.equal(REMIND_SENT, GPS_REMIND_SENT);
  assert.equal(REMIND_NO_DEVICE, GPS_REMIND_NONE);
  assert.match(REMIND_BODY, /clock on in CallUp, allow location, and keep CallUp open on site/);
  const banner = locationRemindBannerHtml();
  assert.match(banner, /data-gps-open/);
  assert.match(banner, /Please turn on location sharing/);
  assert.doesNotMatch(banner, /\$|invoice/);
});

test("admins and supervisors may remind; a manager may not", () => {
  assert.equal(canSendLocationReminder({ uid: "bea", profile: { role: "admin", companyId: "bravo" } }).ok, true);
  assert.equal(canSendLocationReminder({ uid: "sid", profile: { role: "supervisor", companyId: "bravo" } }).companyId, "bravo");
  assert.equal(canSendLocationReminder({ uid: "mo", profile: { role: "manager", companyId: "bravo" } }).ok, false);
  assert.equal(canSendLocationReminder({ uid: "bo", profile: { role: "operator", companyId: "bravo" } }).ok, false);
  assert.equal(canSendLocationReminder({ uid: "lee", profile: { role: "labourer", companyId: "bravo" } }).ok, false);
  assert.equal(canSendLocationReminder({ uid: ALEX, profile: null }).ok, true);
  assert.equal(canSendLocationReminder({ uid: PATRICK, profile: { role: "operator", companyId: "heartwood" } }).ok, true);
  assert.equal(canSendLocationReminder({ uid: "hana", profile: { role: "manager", companyId: "heartwood" } }).ok, false);
  assert.equal(canSendLocationReminder({ uid: "sue", profile: { role: "supervisor", companyId: "heartwood" } }).ok, true);
  assert.equal(canSendLocationReminder({
    uid: "ada", profile: { role: "admin", companyId: "heartwood" }, heartwoodGrant: false,
  }).ok, false);
  assert.equal(canSendLocationReminder({
    uid: "ada", profile: { role: "admin", companyId: "heartwood" }, heartwoodGrant: true,
  }).ok, true);
  assert.equal(companyIdOf(null, "nobody"), "");
  assert.equal(canRemindLocation({ role: "admin", cloudProfile: { role: "admin" } }), true);
  assert.equal(canRemindLocation({ role: "supervisor", cloudProfile: { role: "supervisor" } }), true);
  assert.equal(canRemindLocation({ role: "admin", cloudProfile: { role: "manager" }, staffRole: "manager" }), false);
  assert.equal(canRemindLocation({ role: "admin", staffRole: "operator", cloudProfile: { role: "operator" } }), true);
  assert.equal(canRemindLocation({ role: "operator" }), false);
  assert.equal(canRemindLocation(null), false);
});

test("sharing is clocked on with gps, and the rate limit is 30 minutes", () => {
  assert.equal(isSharingLocation({ uid: "bo", companyId: "bravo", clockedOn: true, sharing: "gps" }, "bravo", "bo"), true);
  assert.equal(isSharingLocation({ uid: "bo", companyId: "bravo", clockedOn: true, sharing: "off" }, "bravo", "bo"), false);
  assert.equal(isSharingLocation({ uid: "bo", companyId: "bravo", clockedOn: false, sharing: "gps" }, "bravo", "bo"), false);
  assert.equal(isSharingLocation({ uid: "bo", companyId: "heartwood", clockedOn: true, sharing: "gps" }, "bravo", "bo"), false);
  assert.equal(isSharingLocation(null, "bravo", "bo"), false);
  assert.equal(rosterShareState({ clockedOn: true, sharing: "gps" }).text, "Sharing location");
  assert.equal(rosterShareState(null).text, "Not sharing");
  const at = NOW.getTime();
  assert.equal(remindRateOk(at - REMIND_WINDOW_MS + 1, NOW).ok, false);
  assert.equal(remindRateOk(at - REMIND_WINDOW_MS, NOW).ok, true);
  assert.equal(remindRateOk(null, NOW).ok, true);
  assert.equal(REMIND_WINDOW_MS, 30 * 60 * 1000);
});

test("the push opens the clock-on screen and drops a dead token", () => {
  const [push] = reminderPushes([
    { id: "tok1", token: TOKEN, companyId: "bravo", origin: "https://app.callupapp.com.au" },
    { id: "old", token: TOKEN, companyId: "heartwood", origin: "https://jobs.heartwoodew.com" },
    { id: "short", token: "nope", companyId: "bravo", origin: "https://app.callupapp.com.au" },
  ], { uid: "bo", companyId: "bravo" });
  assert.equal(push.message.data.body, REMIND_BODY);
  assert.equal(push.message.data.title, "Turn on location sharing");
  assert.equal(push.message.data.url, "https://app.callupapp.com.au/app/?open=timesheet");
  assert.equal(push.message.webpush.fcmOptions.link, push.message.data.url);
  assert.equal(push.message.notification.title, "Turn on location sharing");
  assert.equal(push.message.webpush.notification.body, REMIND_BODY);
  assert.equal(push.message.token, TOKEN);
  assert.equal(locationOpenUrl("https://evil.example", "heartwood"), "https://jobs.heartwoodew.com/app/?open=timesheet");
  assert.equal(pushTargetFromUrl(push.message.data.url).kind, "timesheet");
  assert.equal(actionForCall("remindLocationSharing"), "gps-remind");
  assert.match(needsSignal("gps-remind", false).message, /signal/);
});

test("a supervisor sends one reminder and a second try inside 30 minutes is refused", async () => {
  const users = {
    sid: user("supervisor", "bravo"),
    bo: user("operator", "bravo"),
  };
  const first = deps({
    users,
    tokens: { bo: [{ id: "tok1", token: TOKEN, companyId: "bravo", origin: "https://app.callupapp.com.au" }] },
  });
  const sent = await remindLocationSharing({ callerUid: "sid", targetUid: "bo" }, first);
  assert.equal(sent.ok, true);
  assert.equal(sent.message, REMIND_SENT);
  assert.equal(sent.sent, 1);
  assert.equal(first.notices.length, 1);
  assert.equal(first.notices[0].body, REMIND_BODY);
  assert.equal(first.notices[0].companyId, "bravo");
  assert.equal(first.sent[0].data.kind, "location");

  const again = deps({
    users,
    sentAt: { bo: NOW.getTime() - 60 * 1000 },
    tokens: { bo: [{ id: "tok1", token: TOKEN, companyId: "bravo", origin: "https://app.callupapp.com.au" }] },
  });
  const limited = await remindLocationSharing({ callerUid: "sid", targetUid: "bo" }, again);
  assert.equal(limited.ok, false);
  assert.equal(limited.reason, "rate-limited");
  assert.equal(limited.message, REMIND_RATE);
  assert.equal(again.notices.length, 0);
  assert.equal(again.sent.length, 0);
});

test("someone already sharing is not nagged, and another company is refused", async () => {
  const users = {
    bea: user("admin", "bravo"),
    bo: user("operator", "bravo"),
    sam: user("operator", "heartwood"),
    mo: user("manager", "bravo"),
  };
  const sharing = deps({
    users,
    live: { "bravo/bo": { uid: "bo", companyId: "bravo", clockedOn: true, sharing: "gps" } },
    tokens: { bo: [{ id: "tok1", token: TOKEN, companyId: "bravo", origin: "https://app.callupapp.com.au" }] },
  });
  const skipped = await remindLocationSharing({ callerUid: "bea", targetUid: "bo" }, sharing);
  assert.equal(skipped.reason, "already-sharing");
  assert.equal(skipped.message, REMIND_SHARING);
  assert.equal(sharing.notices.length, 0);

  const cross = await remindLocationSharing({ callerUid: "bea", targetUid: "sam" }, deps({ users }));
  assert.equal(cross.reason, "permission-denied");
  const manager = await remindLocationSharing({ callerUid: "mo", targetUid: "bo" }, deps({ users }));
  assert.equal(manager.reason, "permission-denied");
  const anon = await remindLocationSharing({ callerUid: "", targetUid: "bo" }, deps({ users }));
  assert.equal(anon.reason, "unauthenticated");
  const junk = await remindLocationSharing({ callerUid: "bea", targetUid: "../bo" }, deps({ users }));
  assert.equal(junk.reason, "permission-denied");
});

test("no registered device is named, and an invalid token is deleted", async () => {
  const users = { sue: user("supervisor", "heartwood"), sam: user("operator", "heartwood") };
  const none = deps({ users, tokens: { sam: [] } });
  const missing = await remindLocationSharing({ callerUid: "sue", targetUid: "sam" }, none);
  assert.equal(missing.ok, true);
  assert.equal(missing.message, REMIND_NO_DEVICE);
  assert.equal(none.notices.length, 1);
  assert.equal(none.sent.length, 0);

  const dead = deps({
    users,
    tokens: { sam: [{ id: "dead", token: TOKEN, companyId: "heartwood", origin: "https://jobs.heartwoodew.com" }] },
    send: () => ({ responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] }),
  });
  const pruned = await remindLocationSharing({ callerUid: "sue", targetUid: "sam" }, dead);
  assert.equal(pruned.message, REMIND_NO_DEVICE);
  assert.equal(dead.dropped.length, 1);
  assert.equal(dead.dropped[0].tokenId, "dead");
  assert.equal(dead.dropped[0].uid, "sam");
});

test("the staff roster shows sharing next to the name and hides the button while GPS is on", () => {
  const logins = [
    { uid: "bo", name: "Bo", email: "bo@bravo.test", role: "operator", companyId: "bravo" },
    { uid: "lee", name: "Lee", email: "lee@bravo.test", role: "labourer", companyId: "bravo" },
    { uid: "bea", name: "Bea", email: "bea@bravo.test", role: "admin", companyId: "bravo" },
  ];
  const html = staffViewHtml([], {
    now: NOW, companyId: "bravo", origin: "https://app.callupapp.com.au", logins, remindGps: true, viewerUid: "bea",
    locations: {
      bo: { clockedOn: true, sharing: "gps" },
      lee: { clockedOn: true, sharing: "off" },
    },
  });
  const card = uid => {
    const start = html.indexOf(`data-staff-uid="${uid}"`);
    return html.slice(start, html.indexOf("</article>", start));
  };
  const bo = card("bo");
  const lee = card("lee");
  assert.match(bo, /Sharing location/);
  assert.match(bo, /data-gps="on"/);
  assert.doesNotMatch(bo, /data-gps-remind|Remind to turn on GPS/);
  assert.match(lee, /Not sharing/);
  assert.match(lee, /data-gps-remind="lee"/);
  assert.match(lee, /Remind to turn on GPS/);
  const manager = staffViewHtml([], {
    now: NOW, companyId: "bravo", logins, remindGps: false, locations: { lee: { clockedOn: false, sharing: "off" } },
  });
  assert.match(manager, /Not sharing/);
  assert.doesNotMatch(manager, /Remind to turn on GPS/);
  const pending = staffViewHtml([
    { id: "p", name: "Casey", email: "casey@bravo.test", role: "operator", status: "pending", token: "a".repeat(43), expiresAt: "2026-11-30T00:00:00.000Z", companyId: "bravo" },
  ], { now: NOW, companyId: "bravo", remindGps: true, locations: {} });
  const invite = pending.slice(pending.indexOf('data-staff-status="pending"'), pending.indexOf("</article>") + 10);
  assert.doesNotMatch(invite, /Remind to turn on GPS|Sharing location|Not sharing/);
});

test("the callable is wired, refuses tests, and the rules stay a read for the person", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /export const remindLocationSharing = onCall/);
  assert.match(index, /NODE_TEST_CONTEXT/);
  assert.match(index, /locationNotices/);
  assert.match(index, /getMessaging\(\)\.sendEach/);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /data-gps-remind/);
  assert.match(app, /remindLocationSharing/);
  assert.match(app, /open=timesheet|kind === "timesheet"/);
  assert.match(app, /liveCollectionPath\(companyId\)/);
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/users\/\{uid\}\/locationNotices\/\{noticeId\}/);
  assert.match(emu, /match \/users\/\{uid\}\/locationNotices\/\{noticeId\}/);
  assert.match(rules, /allow create, update, delete: if false/);
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v160-clock-adjust/);
  const migration = readFileSync(new URL("../MIGRATION.md", import.meta.url), "utf8");
  assert.match(migration, /remindLocationSharing/);
  assert.match(migration, /callup-shell-v160-clock-adjust/);
  assert.match(migration, /Do not deploy from this branch/);
});
