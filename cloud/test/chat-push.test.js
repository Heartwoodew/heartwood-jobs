import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANDROID_BLOCKED_STEPS, IOS_BLOCKED_STEPS, IOS_HOME_STEPS, PROMPT_MISSED, PUSH_ORIGINS as pageOrigins,
  blockedNotificationSteps, foregroundPushText, iosOpenedFromHomeScreen, iosPushHint, permissionResultMessage, pushBannerHtml, pushDeliveryStatus, pushEnableError, pushTargetFromUrl, shouldRequestOnTap, shouldToast, tokenDocId, vapidReady,
} from "../../app/features/push-logic.js";
import {
  ALEX_UID, PATRICK_UID, PUSH_BODY_MAX, PUSH_ORIGINS, canReceiveChat, chatOpenUrl, chatPushContent,
  dispatchChatPush, fcmData, fcmMessage, isStaleTokenError, logPushException, logPushSend, sanitizePushErrorMessage, selectChatRecipients, staleTargets, truncatePush, userCompany,
} from "../functions/chat-push.js";

const heartwoodOp = { role: "operator", name: "Sam" };
const heartwoodAdmin = { role: "admin", name: "Ada" };
const scoped = { role: "operator", name: "Scope", customerIds: ["Orbit Homes (Qld) Pty Ltd"] };
const other = { role: "operator", name: "Other", companyId: "otherco", tenantId: "otherco" };
const job = {
  id: "job1",
  client: "Orbit Homes (Qld) Pty Ltd",
  address: "1 Creek Rd, Springfield QLD 4300",
  assigned: ["op1", "sup1", "scoped"],
  companyId: "heartwood",
  invoiceAmount: 880,
};
const silk = {
  id: "silk",
  client: "Silkwood Homes",
  address: "9 Silk St, Goodna",
  assigned: ["scoped", "op1"],
  companyId: "heartwood",
};

function person(uid, profile, { muteChat = false, companyId = "heartwood", origin = "https://jobs.heartwoodew.com", token = "fcm-token-value-0123456789-" + uid } = {}) {
  return {
    uid,
    profile,
    muteChat,
    tokens: [{ id: "t-" + uid, token, companyId, origin }],
  };
}

test("recipient selection excludes the sender, other companies and muted people", () => {
  const people = [
    person("op1", heartwoodOp),
    person("idle", { role: "operator", name: "Idle" }),
    person("sup1", { role: "supervisor", name: "Sue" }),
    person("ada", heartwoodAdmin),
    person("scoped", scoped),
    person(ALEX_UID, null),
    person(PATRICK_UID, { role: "operator", name: "Patrick" }),
    person("op2", other, { companyId: "otherco", origin: "https://app.callupapp.com.au" }),
    person("muted", heartwoodOp, { muteChat: true }),
    person("crossed", { role: "admin", name: "Cross", companyId: "otherco" }, { companyId: "heartwood" }),
  ];
  const staff = selectChatRecipients({
    tenantId: "heartwood", threadId: "staff", senderUid: "op1", job: null, people,
  }).map(r => r.uid);
  assert.deepEqual(staff.sort(), [ALEX_UID, PATRICK_UID, "ada", "idle", "scoped", "sup1"].sort());
  assert.equal(staff.includes("op1"), false);
  assert.equal(staff.includes("muted"), false);
  assert.equal(staff.includes("op2"), false);

  const crew = selectChatRecipients({
    tenantId: "heartwood", threadId: "job_job1", senderUid: "op1", job, people,
  }).map(r => r.uid);
  assert.deepEqual(crew.sort(), [ALEX_UID, PATRICK_UID, "ada", "scoped", "sup1"].sort());
  assert.equal(crew.includes("idle"), false);

  const silkIds = selectChatRecipients({
    tenantId: "heartwood", threadId: "job_silk", senderUid: "ada", job: silk, people,
  }).map(r => r.uid);
  assert.equal(silkIds.includes("scoped"), false);
  assert.equal(silkIds.includes("op1"), true);
  assert.equal(silkIds.includes(ALEX_UID), true);

  const otherHeard = selectChatRecipients({
    tenantId: "otherco", threadId: "staff", senderUid: "ada", job: null, people,
  }).map(r => r.uid);
  assert.deepEqual(otherHeard, ["op2"]);
  assert.equal(canReceiveChat({
    uid: "op1", profile: heartwoodOp, tenantId: "otherco", threadId: "staff", job: null,
  }), false);
  assert.equal(canReceiveChat({
    uid: ALEX_UID, profile: null, tenantId: "otherco", threadId: "job_job1", job,
  }), false);
  assert.equal(userCompany({ companyId: "otherco", tenantId: "heartwood" }, "x"), "otherco");
  assert.equal(userCompany(null, ALEX_UID), "heartwood");
  assert.equal(userCompany(null, "stranger"), "");
});

test("a mismatched job sends to nobody", async () => {
  const people = [person("ada", heartwoodAdmin), person("op1", heartwoodOp)];
  const wrong = await dispatchChatPush({
    tenantId: "heartwood",
    threadId: "job_job1",
    message: { senderUid: "idle", senderName: "Idle", text: "Hi" },
    loadJob: async () => ({ ...job, companyId: "otherco" }),
    loadPeople: async () => people,
    sendEach: async () => { throw new Error("should not send"); },
    deleteToken: async () => { throw new Error("should not delete"); },
  });
  assert.equal(wrong.sent, 0);
});

test("stale tokens are removed and other send errors are kept", async () => {
  const dropped = [];
  const result = await dispatchChatPush({
    tenantId: "heartwood",
    threadId: "staff",
    message: { senderUid: "op1", senderName: "Sam", text: "On site" },
    loadJob: async () => null,
    loadPeople: async () => [person("idle", { role: "operator" }), person("ada", { role: "admin" })],
    sendEach: async () => ({
      responses: [
        { success: false, error: { code: "messaging/registration-token-not-registered" } },
        { success: false, error: { code: "messaging/internal-error" } },
      ],
    }),
    deleteToken: async (target) => { dropped.push(target.uid); },
  });
  assert.deepEqual(dropped, ["idle"]);
  assert.equal(result.dropped, 1);
  assert.equal(result.sent, 0);
  assert.equal(isStaleTokenError({ code: "messaging/invalid-registration-token" }), true);
  assert.equal(isStaleTokenError({ code: "messaging/internal-error" }), false);
  assert.equal(staleTargets([{ success: true }], [{ uid: "a" }]).length, 0);
});

test("an enabled banner has no in-app-only text, and a foreground toast uses notification text", () => {
  const on = pushBannerHtml({ enabled: true, permission: "granted" });
  assert.equal(on, "");
  assert.equal(on.includes("In-app alerts only"), false);
  const off = pushBannerHtml({ enabled: false, permission: "granted" });
  assert.match(off, /In-app alerts only/);
  assert.match(off, /Turn on notifications/);
  const fromNote = foregroundPushText({ notification: { title: "Sam · Team chat", body: "On site" }, data: {} });
  assert.equal(fromNote.title, "Sam · Team chat");
  assert.equal(fromNote.body, "On site");
  const fromData = foregroundPushText({
    notification: { title: "Ignored", body: "Ignored" },
    data: { title: "Sam · Team chat", body: "On site", threadId: "staff" },
  });
  assert.deepEqual(fromData, { title: "Sam · Team chat", body: "On site", threadId: "staff" });
  assert.deepEqual(foregroundPushText(null), { title: "", body: "", threadId: "" });
});

test("fcm data values are strings, with high android priority and a web push TTL", () => {
  const shown = fcmMessage(
    { token: "not-logged" },
    {
      url: "https://jobs.heartwoodew.com/app/?chat=staff",
      data: { kind: "chat", count: 2, ok: false, title: "Hi", empty: null, url: "https://jobs.heartwoodew.com/app/?chat=staff" },
    },
  );
  assert.deepEqual(fcmData({ count: 2, ok: true, empty: null, title: "Hi" }), { count: "2", ok: "true", empty: "", title: "Hi" });
  for (const value of Object.values(shown.data)) assert.equal(typeof value, "string");
  assert.equal(shown.data.count, "2");
  assert.equal(shown.data.ok, "false");
  assert.equal(shown.data.empty, "");
  assert.equal(shown.notification.title, "Hi");
  assert.equal(shown.android.priority, "high");
  assert.equal(shown.webpush.headers.Urgency, "high");
  assert.equal(shown.webpush.headers.TTL, "86400");
});

function recordingWriter() {
  const lines = [];
  const write = {
    log: (...args) => { lines.push(args.map(part => String(part)).join(" ")); },
    error: (...args) => { lines.push(args.map(part => String(part)).join(" ")); },
  };
  return { lines, write, text: () => lines.join("\n") };
}

test("a failed send logs the FCM error code and not the device token", async () => {
  const token = "fcm-token-value-0123456789-secret";
  const recorded = recordingWriter();
  const result = await dispatchChatPush({
    tenantId: "heartwood",
    threadId: "staff",
    message: { senderUid: "op1", senderName: "Sam", text: "On site" },
    loadJob: async () => null,
    loadPeople: async () => [person("ada", { role: "admin" }, { token })],
    sendEach: async () => ({
      responses: [
        { success: false, error: { code: "messaging/invalid-argument", message: "rejected " + token + " messaging/registration-token-not-registered" } },
      ],
    }),
    deleteToken: async () => {},
    reportSend: (label, responses, targets, fields) => logPushSend(label, responses, targets, fields, recorded.write),
  });
  assert.equal(result.sent, 0);
  assert.equal(result.dropped, 0);
  const output = recorded.text();
  assert.match(output, /chat push heartwood staff targets 1 sent 0 dropped 0/);
  assert.match(output, /fcm-error messaging\/invalid-argument/);
  assert.match(output, /messaging\/registration-token-not-registered/);
  assert.equal(output.includes(token), false);
  const direct = recordingWriter();
  logPushSend("chat push", [
    { success: false, error: { code: "messaging/internal-error", message: "bad " + token } },
  ], [{ token }], [], direct.write);
  assert.match(direct.text(), /messaging\/internal-error/);
  assert.equal(direct.text().includes(token), false);
  assert.equal(sanitizePushErrorMessage("see " + token).includes(token), false);
});

test("a send exception is logged and does not include the device token", async () => {
  const token = "fcm-token-value-0123456789-secret";
  const recorded = recordingWriter();
  const result = await dispatchChatPush({
    tenantId: "heartwood",
    threadId: "staff",
    message: { senderUid: "op1", senderName: "Sam", text: "On site" },
    loadJob: async () => null,
    loadPeople: async () => [person("ada", { role: "admin" }, { token })],
    sendEach: async () => {
      const err = new Error("send failed " + token);
      err.code = "messaging/internal-error";
      throw err;
    },
    deleteToken: async () => {},
    reportException: (label, err) => logPushException(label, err, recorded.write),
  });
  assert.equal(result.skipped, "send");
  assert.equal(result.sent, 0);
  const output = recorded.text();
  assert.match(output, /chat push exception messaging\/internal-error/);
  assert.equal(output.includes(token), false);
  const schedule = readFileSync(new URL("../functions/push-schedule.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(schedule, /logPushException\(label, err\)/);
  assert.match(schedule, /await runPush\("chat push"/);
  assert.match(schedule, /await runPush\("daily jobs"/);
  assert.match(schedule, /await runPush\("daily change"/);
  assert.match(schedule, /await runPush\("prestart"/);
  assert.match(index, /logPushException\("location remind"/);
  assert.match(index, /logPushException\("support ticket"/);
});

test("notification copy is the sender and the chat, with text cut to about 100 characters", () => {
  const note = chatPushContent({
    tenantId: "heartwood",
    threadId: "job_job1",
    message: { senderName: "Sam", text: "  On site\nnow  " },
    job,
    origin: "https://jobs.heartwoodew.com",
  });
  assert.equal(note.title, "Sam · Springfield");
  assert.equal(note.body, "On site now");
  assert.equal(note.data.url, "https://jobs.heartwoodew.com/app/?chat=job_job1");
  assert.equal(note.data.invoiceAmount, undefined);
  assert.equal(JSON.stringify(note).includes("880"), false);
  assert.equal(JSON.stringify(note).includes("$"), false);
  const priced = chatPushContent({
    tenantId: "heartwood",
    threadId: "staff",
    message: { senderName: "Sam", text: "Tip was $40 cash" },
    job: null,
    origin: "https://jobs.heartwoodew.com",
  });
  assert.equal(priced.title, "Sam · Team chat");
  assert.equal(priced.body, "Tip was $40 cash");
  const long = "a".repeat(180);
  assert.equal(truncatePush(long, PUSH_BODY_MAX).length, PUSH_BODY_MAX);
  assert.equal(chatPushContent({
    tenantId: "heartwood", threadId: "staff", message: { senderName: "Sam", text: long }, job: null, origin: "https://jobs.heartwoodew.com",
  }).body.length, PUSH_BODY_MAX);
  const photo = chatPushContent({
    tenantId: "otherco", threadId: "staff", message: { senderName: "Other", text: "", photoPath: "tenants/otherco/chat/staff/photos/c12345678" }, job: null, origin: "",
  });
  assert.equal(photo.body, "Sent a photo");
  assert.equal(photo.title, "Other · Team chat");
  assert.equal(chatOpenUrl("https://evil.example", "staff", "otherco"), "https://app.callupapp.com.au/app/?chat=staff");
  assert.deepEqual(PUSH_ORIGINS, pageOrigins);
});

test("opt-in stays a button press, and iPhone Safari shows the Home Screen hint", async () => {
  assert.equal(iosPushHint({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  }), IOS_HOME_STEPS);
  assert.match(IOS_HOME_STEPS, /Add CallUp to your Home Screen first/);
  assert.match(IOS_HOME_STEPS, /Share/);
  assert.match(IOS_HOME_STEPS, /Add to Home Screen/);
  assert.equal(iosOpenedFromHomeScreen({ navigatorStandalone: false, displayMode: true }), false);
  assert.equal(iosOpenedFromHomeScreen({ navigatorStandalone: true, displayMode: false }), true);
  assert.equal(iosOpenedFromHomeScreen({ displayMode: true }), true);
  assert.equal(iosPushHint({ userAgent: "iPhone", standalone: true, displayMode: true }), "");
  assert.equal(iosPushHint({ userAgent: "iPhone", standalone: true, pushManager: false }), IOS_HOME_STEPS);
  assert.equal(iosPushHint({ userAgent: "iPhone", standalone: true, notification: false }), IOS_HOME_STEPS);
  assert.equal(iosPushHint({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0" }), "");
  assert.equal(iosPushHint({ userAgent: "iPhone", standalone: true }), "");
  const inApp = pushDeliveryStatus({ iosHint: IOS_HOME_STEPS, subscribed: false });
  assert.equal(inApp.mode, "in-app");
  assert.match(inApp.label, /In-app alerts only/);
  assert.match(inApp.label, /while CallUp is open/);
  assert.equal(inApp.steps, IOS_HOME_STEPS);
  const background = pushDeliveryStatus({ permission: "granted", subscribed: true });
  assert.equal(background.mode, "background");
  assert.equal(background.label, "Background notifications on");
  assert.match(pushDeliveryStatus({ permission: "denied" }).steps, /On Android, allow notifications/);
  assert.equal(shouldRequestOnTap({ permission: "default", hasRequest: true }), true);
  assert.equal(shouldRequestOnTap({ permission: "granted", hasRequest: true }), true);
  assert.equal(shouldRequestOnTap({ permission: "denied", hasRequest: true }), false);
  assert.equal(shouldRequestOnTap({ permission: "default", iosHint: IOS_HOME_STEPS, hasRequest: true }), false);
  assert.equal(shouldRequestOnTap({ permission: "default", hasRequest: false }), false);
  assert.equal(blockedNotificationSteps({ ios: true }), IOS_BLOCKED_STEPS);
  assert.equal(blockedNotificationSteps({ ios: false }), ANDROID_BLOCKED_STEPS);
  assert.match(IOS_BLOCKED_STEPS, /Settings/);
  assert.match(IOS_BLOCKED_STEPS, /Notifications/);
  assert.match(IOS_BLOCKED_STEPS, /CallUp/);
  assert.match(IOS_BLOCKED_STEPS, /Allow Notifications/);
  assert.match(ANDROID_BLOCKED_STEPS, /site settings/);
  assert.equal(permissionResultMessage("granted", { ios: true }), "");
  assert.equal(permissionResultMessage("denied", { ios: true }), IOS_BLOCKED_STEPS);
  assert.equal(permissionResultMessage("denied", { ios: false }), ANDROID_BLOCKED_STEPS);
  assert.equal(permissionResultMessage("default", { ios: true }), PROMPT_MISSED);
  assert.match(PROMPT_MISSED, /didn't appear/);
  assert.match(PROMPT_MISSED, /try again/);
  assert.match(pushEnableError({ message: "push-service-error" }), /push-service-error/);
  assert.match(pushEnableError({ code: "permission-denied" }), /can't enable notifications/);
  const shown = fcmMessage(
    { token: "fcm-token-value-0123456789" },
    { url: "https://jobs.heartwoodew.com/app/?chat=staff", data: { title: "Sam · Team chat", body: "On site", url: "https://jobs.heartwoodew.com/app/?chat=staff", kind: "chat" } },
  );
  assert.equal(shown.notification.title, "Sam · Team chat");
  assert.equal(shown.notification.body, "On site");
  assert.equal(shown.webpush.notification.title, "Sam · Team chat");
  assert.equal(shown.webpush.notification.icon, "https://jobs.heartwoodew.com/app/icons/icon-192.png");
  assert.equal(shown.webpush.fcmOptions.link, "https://jobs.heartwoodew.com/app/?chat=staff");
  assert.equal(shown.webpush.headers.Urgency, "high");
  assert.equal(shown.webpush.headers.TTL, "86400");
  assert.equal(shown.android.priority, "high");
  assert.equal(shown.data.kind, "chat");
  assert.equal(shouldToast({ visibility: "visible", viewingThread: "staff", threadId: "staff" }), false);
  assert.equal(shouldToast({ visibility: "hidden", viewingThread: "", threadId: "staff" }), false);
  assert.equal(shouldToast({ visibility: "visible", viewingThread: "staff", threadId: "job_job1" }), true);
  assert.equal(pushTargetFromUrl("https://jobs.heartwoodew.com/app/?chat=job_job1").thread, "job_job1");
  assert.equal(pushTargetFromUrl("https://app.callupapp.com.au/app/?jobs=today").kind, "today");
  assert.equal(pushTargetFromUrl("https://jobs.heartwoodew.com/app/?chat=../finance"), null);
  assert.equal(vapidReady(""), false);
  assert.equal(vapidReady("REPLACE_WITH_WEB_PUSH_CERTIFICATE"), false);
  assert.equal(vapidReady("B".repeat(80)), true);
  const id = await tokenDocId("fcm-token-value-0123456789");
  assert.match(id, /^[a-f0-9]{32}$/);

  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const logic = readFileSync(new URL("../../app/features/push-logic.js", import.meta.url), "utf8");
  const notify = readFileSync(new URL("../../app/features/push.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../../app/firebase-config.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /requestPermission/);
  assert.match(logic, /Turn on notifications/);
  assert.match(logic, /Mute chat notifications/);
  assert.match(logic, /Mute daily job list/);
  assert.match(logic, /Add CallUp to your Home Screen first/);
  assert.match(logic, /Background notifications on/);
  assert.match(logic, /In-app alerts only/);
  const tapStart = notify.indexOf("function onPushTap");
  const tapEnd = notify.indexOf("async function continueAfterGrant");
  const tap = notify.slice(tapStart, tapEnd);
  assert.ok(tapStart >= 0 && tapEnd > tapStart);
  assert.doesNotMatch(tap, /\bawait\b/);
  assert.doesNotMatch(tap, /import\(|getToken|saveToken|serviceWorker\.ready|getDocs|setDoc/);
  assert.match(tap, /Notification\.requestPermission\(\)/);
  const askAt = tap.indexOf("Notification.requestPermission()");
  assert.equal(tap.slice(0, askAt).includes("await"), false);
  const after = notify.slice(tapEnd, notify.indexOf("function bindRoot"));
  assert.doesNotMatch(after, /requestPermission/);
  assert.match(after, /if \(perm !== "granted"\)/);
  assert.match(after, /saveToken\(\)/);
  const enabledAt = after.indexOf("state.enabled = true");
  const prefsAt = after.indexOf("writePrefs(");
  const rerenderAt = after.indexOf("deps.rerender");
  assert.ok(enabledAt >= 0 && prefsAt > enabledAt && rerenderAt > prefsAt);
  assert.match(notify, /addEventListener\("click", onPushTap\)/);
  assert.match(logic, /class="sm-btn primary push-enable"/);
  assert.equal((logic.match(/push-enable/g) || []).length >= 2, true);
  assert.match(config, /export const vapidKey = "BMyCNKMjDvbOQW74GyjS7GlTo-Qe7r203dbshLNIPpuDcaafAuZmq-WSjX7Ptys4ZTXEH1GKy8QhtkNsaD1Zlk8"/);
  assert.doesNotMatch(config, /vapidKey = "REPLACE_WITH_WEB_PUSH_CERTIFICATE"/);
  assert.match(config, /Web Push certificates/);
  assert.doesNotMatch(config, /BEGIN PRIVATE|-----BEGIN/);
  assert.equal(vapidReady("BMyCNKMjDvbOQW74GyjS7GlTo-Qe7r203dbshLNIPpuDcaafAuZmq-WSjX7Ptys4ZTXEH1GKy8QhtkNsaD1Zlk8"), true);

  assert.match(sw, /callup-shell-v166/);
  assert.match(notify, /foregroundPushText\(payload\)/);
  const css = readFileSync(new URL("../../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.push-banner\[hidden\]\{display:none !important\}/);
  const bannerFn = logic.slice(logic.indexOf("export function pushBannerHtml"));
  assert.match(bannerFn, /subscribed:\s*model\.enabled/);
  assert.doesNotMatch(bannerFn, /subscribed:\s*false/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /note\.title/);
  assert.match(sw, /showNotification/);
  assert.match(readFileSync(new URL("../../app/app.js", import.meta.url), "utf8"), /serviceWorker\.register\("sw\.js"/);
  assert.match(sw, /visibilityState === "visible"/);
  assert.match(sw, /features\/push\.js/);
  assert.match(index, /chatMessagePush/);
  assert.match(index, /dailyJobPush/);
  assert.match(index, /dailyJobChangePush/);
  assert.doesNotMatch(index, /onSchedule/);
});
