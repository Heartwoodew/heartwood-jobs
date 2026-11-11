import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUSH_ORIGINS as pageOrigins } from "../../app/features/chat-notify-logic.js";
import {
  incomingPing, iosPushHint, readChatParam, takeHead, takeIncoming, tokenDocId, chatAlertsHtml,
} from "../../app/features/chat-notify-logic.js";
import {
  ALEX_UID, PATRICK_UID, PUSH_ORIGINS, canReceiveChat, chatOpenUrl, chatPushContent,
  dispatchChatPush, isStaleTokenError, selectChatRecipients, staleTargets, userCompany,
} from "../functions/chat-push.js";

const heartwoodOp = { role: "operator", name: "Sam" };
const heartwoodAdmin = { role: "admin", name: "Ada" };
const scoped = { role: "operator", name: "Scope", customerIds: ["Orbit Homes (Qld) Pty Ltd"] };
const other = { role: "operator", name: "Other", companyId: "otherco", tenantId: "otherco" };
const job = {
  id: "job1",
  client: "Orbit Homes (Qld) Pty Ltd",
  address: "1 Creek Rd",
  assigned: ["op1", "sup1", "scoped"],
  companyId: "heartwood",
};
const silk = {
  id: "silk",
  client: "Silkwood Homes",
  assigned: ["scoped", "op1"],
  companyId: "heartwood",
};

function person(uid, profile, { push = true, companyId = "heartwood", origin = "https://jobs.heartwoodew.com", token = "fcm-token-value-0123456789-" + uid } = {}) {
  return {
    uid,
    profile,
    push,
    tokens: [{ id: "t-" + uid, token, companyId, origin }],
  };
}

test("recipient selection follows chat visibility and company isolation", () => {
  const people = [
    person("op1", heartwoodOp),
    person("idle", { role: "operator", name: "Idle" }),
    person("sup1", { role: "supervisor", name: "Sue" }),
    person("ada", heartwoodAdmin),
    person("scoped", scoped),
    person(ALEX_UID, null),
    person(PATRICK_UID, { role: "operator", name: "Patrick" }),
    person("op2", other, { companyId: "otherco", origin: "https://app.callupapp.com.au" }),
    person("muted", heartwoodOp, { push: false }),
    person("crossed", { role: "admin", name: "Cross", companyId: "otherco" }, { companyId: "heartwood" }),
  ];
  const staff = selectChatRecipients({
    tenantId: "heartwood", threadId: "staff", senderUid: "op1", job: null, people,
  }).map(r => r.uid);
  assert.deepEqual(staff.sort(), [ALEX_UID, PATRICK_UID, "ada", "idle", "scoped", "sup1"].sort());

  const crew = selectChatRecipients({
    tenantId: "heartwood", threadId: "job_job1", senderUid: "op1", job, people,
  }).map(r => r.uid);
  assert.deepEqual(crew.sort(), [ALEX_UID, PATRICK_UID, "ada", "scoped", "sup1"].sort());

  const silkIds = selectChatRecipients({
    tenantId: "heartwood", threadId: "job_silk", senderUid: "ada", job: silk, people,
  }).map(r => r.uid);
  assert.equal(silkIds.includes("scoped"), false);
  assert.equal(silkIds.includes("op1"), true);
  assert.equal(silkIds.includes("idle"), false);
  assert.equal(silkIds.includes(ALEX_UID), true);

  const otherStaff = selectChatRecipients({
    tenantId: "otherco",
    threadId: "staff",
    senderUid: "op2",
    job: null,
    people,
  });
  assert.deepEqual(otherStaff.map(r => r.uid), []);

  const otherHeard = selectChatRecipients({
    tenantId: "otherco",
    threadId: "staff",
    senderUid: "ada",
    job: null,
    people,
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

test("a mismatched job or a missing push flag sends to nobody", async () => {
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
  const missing = await dispatchChatPush({
    tenantId: "heartwood",
    threadId: "job_missing",
    message: { senderUid: "op1", text: "Hi" },
    loadJob: async () => null,
    loadPeople: async () => people,
    sendEach: async () => { throw new Error("should not send"); },
    deleteToken: async () => {},
  });
  assert.equal(missing.skipped, "job");
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

  const thrown = await dispatchChatPush({
    tenantId: "heartwood",
    threadId: "staff",
    message: { senderUid: "op1", senderName: "Sam", text: "On site" },
    loadJob: async () => null,
    loadPeople: async () => [person("idle", { role: "operator" })],
    sendEach: async () => { const err = new Error("down"); err.code = "messaging/server-unavailable"; throw err; },
    deleteToken: async () => { dropped.push("nope"); },
  });
  assert.equal(thrown.skipped, "send");
  assert.equal(dropped.includes("nope"), false);
});

test("notification copy stays short and the tap link is an allowlisted origin", () => {
  const note = chatPushContent({
    tenantId: "heartwood",
    threadId: "job_job1",
    message: { senderName: "Sam", text: "  On site\nnow  ", photoPath: "" },
    job,
    origin: "https://jobs.heartwoodew.com",
  });
  assert.equal(note.title.startsWith("Job chat"), true);
  assert.equal(note.body, "Sam: On site now");
  assert.equal(note.data.url, "https://jobs.heartwoodew.com/app/?chat=job_job1");
  assert.equal(chatOpenUrl("https://evil.example", "staff", "otherco"), "https://app.callupapp.com.au/app/?chat=staff");
  assert.equal(chatOpenUrl("https://callupapp.web.app", "staff", "heartwood"), "https://callupapp.web.app/app/?chat=staff");
  const photo = chatPushContent({
    tenantId: "otherco", threadId: "staff", message: { senderName: "Other", text: "", photoPath: "tenants/otherco/chat/staff/photos/c12345678" }, job: null, origin: "",
  });
  assert.equal(photo.body, "Other: Photo");
  assert.deepEqual(PUSH_ORIGINS, pageOrigins);
});

test("an open chat does not ping, and the first snapshot is silent", () => {
  const mine = incomingPing({
    message: { id: "1", senderUid: "me", text: "Hi" }, myUid: "me", threadId: "staff", appVisible: true, viewingThreadId: "", soundEnabled: true,
  });
  assert.equal(mine.toast, "");
  const watching = incomingPing({
    message: { id: "2", senderUid: "sam", senderName: "Sam", text: "On site" },
    myUid: "me", threadId: "staff", appVisible: true, viewingThreadId: "staff", soundEnabled: true,
  });
  assert.equal(watching.toast, "");
  const hidden = incomingPing({
    message: { id: "2", senderUid: "sam", senderName: "Sam", text: "On site" },
    myUid: "me", threadId: "staff", appVisible: false, viewingThreadId: "", soundEnabled: true,
  });
  assert.equal(hidden.play, false);
  const heard = incomingPing({
    message: { id: "2", senderUid: "sam", senderName: "Sam", text: "On site" },
    myUid: "me", threadId: "job_job1", appVisible: true, viewingThreadId: "staff", soundEnabled: true,
  });
  assert.equal(heard.play, true);
  assert.equal(heard.toast, "Sam: On site");
  const quiet = incomingPing({
    message: { id: "2", senderUid: "sam", senderName: "Sam", text: "On site" },
    myUid: "me", threadId: "job_job1", appVisible: true, viewingThreadId: "", soundEnabled: false,
  });
  assert.equal(quiet.play, false);
  assert.equal(quiet.toast, "Sam: On site");

  const first = takeIncoming({
    messages: [{ id: "a", senderUid: "sam", senderName: "Sam", text: "old" }],
    myUid: "me", threadId: "staff", appVisible: true, viewingThreadId: "", soundEnabled: true, seen: new Set(), booted: false,
  });
  assert.equal(first.alerts.length, 0);
  const next = takeIncoming({
    messages: [{ id: "a", senderUid: "sam", text: "old" }, { id: "b", senderUid: "sam", senderName: "Sam", text: "new" }],
    myUid: "me", threadId: "staff", appVisible: true, viewingThreadId: "jobs", soundEnabled: true, seen: first.seen, booted: first.booted,
  });
  assert.equal(next.alerts.length, 1);
  const headFirst = takeHead({
    head: { lastSenderUid: "sam", lastSenderName: "Sam", preview: "old", lastAt: 10 },
    myUid: "me", threadId: "job_job1", appVisible: true, viewingThreadId: "", soundEnabled: true, messagesOwned: false, previous: "", booted: false,
  });
  assert.equal(headFirst.alerts.length, 0);
  const headNext = takeHead({
    head: { lastSenderUid: "sam", lastSenderName: "Sam", preview: "later", lastAt: 20 },
    myUid: "me", threadId: "job_job1", appVisible: true, viewingThreadId: "", soundEnabled: true, messagesOwned: false, previous: headFirst.previous, booted: headFirst.booted,
  });
  assert.equal(headNext.alerts.length, 1);
  const owned = takeHead({
    head: { lastSenderUid: "sam", lastSenderName: "Sam", preview: "later", lastAt: 30 },
    myUid: "me", threadId: "job_job1", appVisible: true, viewingThreadId: "", soundEnabled: true, messagesOwned: true, previous: headNext.previous, booted: true,
  });
  assert.equal(owned.alerts.length, 0);
});

test("opt-in copy never asks on load, and iPhone gets the Home Screen hint", async () => {
  const html = chatAlertsHtml({ sound: true, push: false, iosHint: iosPushHint({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" }), vapidReady: true });
  assert.match(html, /Enable chat notifications/);
  assert.match(html, /Home Screen/);
  assert.match(html, /iOS 16\.4/);
  assert.equal(iosPushHint({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0" }), "");
  assert.equal(iosPushHint({ userAgent: "iPhone", standalone: true }), "");
  assert.equal(readChatParam("?chat=staff"), "staff");
  assert.equal(readChatParam("?chat=job_job1"), "job_job1");
  assert.equal(readChatParam("?chat=../finance"), "");
  const id = await tokenDocId("fcm-token-value-0123456789");
  assert.match(id, /^[a-f0-9]{32}$/);

  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../app/features/chat-ui.js", import.meta.url), "utf8");
  const logic = readFileSync(new URL("../../app/features/chat-notify-logic.js", import.meta.url), "utf8");
  const notify = readFileSync(new URL("../../app/features/chat-notify.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../../app/firebase-config.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const firebaseJson = readFileSync(new URL("../firebase.json", import.meta.url), "utf8");
  assert.doesNotMatch(app + ui + sw, /requestPermission/);
  assert.match(logic, /Enable chat notifications/);
  assert.match(notify, /Notification\.requestPermission/);
  assert.match(config, /export const vapidKey = "";/);
  assert.doesNotMatch(config, /BEGIN PRIVATE|-----BEGIN/);
  assert.match(sw, /callup-shell-v86-chat-ping/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /sounds\/chat-ping\.wav/);
  assert.match(index, /chatMessagePush/);
  assert.match(index, /australia-southeast1/);
  assert.match(firebaseJson, /refuse-live-deploy\.js/);
  const wav = readFileSync(new URL("../../app/sounds/chat-ping.wav", import.meta.url));
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.ok(wav.length < 20000);
});
