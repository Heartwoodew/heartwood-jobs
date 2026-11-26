// Phone error capture. No emulator. Checks the text is scrubbed, the phone stops after 20,
// and the settings screen is admin-only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIENT_ERROR_FIELDS, CLIENT_ERROR_MESSAGE_MAX, CLIENT_ERROR_SESSION_MAX, CLIENT_ERROR_STACK_MAX,
  clientErrorPayload, clientErrorScreen, clientErrorText, clientErrorWorthSending, clientErrorWriteDenied, clientErrorsHtml, createClientErrorGate, scrubClientText,
} from "../../app/features/client-errors.js";

const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");

test("secrets, prices, GPS and query strings are stripped before a phone error is stored", () => {
  const dirty = "Clock failed token=abc123 Bearer eyJaaa.bbb.ccc at lat: -27.47012, lng: 153.02513 cost $1,250.00 https://x.test/a?token=zzz#p";
  const clean = scrubClientText(dirty, CLIENT_ERROR_MESSAGE_MAX);
  assert.doesNotMatch(clean, /abc123|eyJ|token=|-27\.47012|153\.02513|1,250|\$/);
  assert.match(clean, /\[redacted\]/);
  assert.match(clean, /\[location\]/);
  assert.match(clean, /\[amount\]/);
  assert.match(clean, /https:\/\/x\.test\/a/);
  assert.doesNotMatch(clean, /\?token/);
  assert.match(scrubClientText("ReferenceError: SHARE_MIN_MS is not defined", 500), /SHARE_MIN_MS is not defined/);
  const stack = "at armShareWatch\n at liveShareStart";
  assert.match(scrubClientText(stack, 200, { keepLines: true }), /armShareWatch\n at liveShareStart/);
  assert.equal(scrubClientText("x".repeat(3000), CLIENT_ERROR_STACK_MAX).length, CLIENT_ERROR_STACK_MAX);
});

test("a session keeps 20 different messages and drops repeats", () => {
  const gate = createClientErrorGate();
  const first = clientErrorPayload({ uid: "u1", companyId: "acme", role: "operator", message: "Clock failed", stack: "a\nb", online: false }, gate);
  assert.equal(first.companyId, "acme");
  assert.equal(first.data.uid, "u1");
  assert.equal(first.data.online, false);
  assert.deepEqual(Object.keys(first.data).sort(), ["appVersion", "message", "online", "role", "screen", "stack", "swVersion", "uid", "userAgent"]);
  assert.equal(clientErrorPayload({ uid: "u1", companyId: "acme", message: "Clock failed" }, gate), null);
  for (let i = 0; i < CLIENT_ERROR_SESSION_MAX - 1; i++) {
    assert.ok(clientErrorPayload({ uid: "u1", companyId: "acme", message: "err " + i }, gate));
  }
  assert.equal(gate.sent, CLIENT_ERROR_SESSION_MAX);
  assert.equal(clientErrorPayload({ uid: "u1", companyId: "acme", message: "one more" }, gate), null);
  assert.equal(clientErrorPayload({ uid: "", companyId: "acme", message: "missing person" }, createClientErrorGate()), null);
  assert.equal(clientErrorPayload({ uid: "u1", companyId: "", message: "missing company" }, createClientErrorGate()), null);
});

test("the stored fields are the timestamp, who, where, and the short text", () => {
  assert.deepEqual([...CLIENT_ERROR_FIELDS], ["createdAt", "uid", "role", "appVersion", "swVersion", "screen", "message", "stack", "userAgent", "online"]);
  assert.equal(clientErrorText({ message: "Boom", code: "unavailable" }), "Boom");
  assert.equal(clientErrorText("plain"), "plain");
  assert.equal(clientErrorScreen({ pathname: "/app/", search: "?token=secret" }, "hours"), "/app/ hours");
  const html = clientErrorsHtml([{ createdAt: new Date("2026-11-26T07:05:00Z"), role: "operator", online: false, screen: "/app/ hours", message: "<script>", stack: "at clock" }], "ok");
  assert.match(html, /Phone errors/);
  assert.match(html, /Offline/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(clientErrorsHtml([], "ok"), /No phone errors yet/);
  assert.equal(clientErrorsHtml([], "loading"), "");
  assert.equal(clientErrorsHtml([], "hidden"), "");
  assert.equal(clientErrorWriteDenied({ code: "permission-denied" }), true);
  assert.equal(clientErrorWriteDenied({ message: "Missing or insufficient permissions." }), true);
  assert.equal(clientErrorWorthSending("permission-denied: companies/acme/clientErrors"), false);
  assert.equal(clientErrorWorthSending("Clock on failed: permission-denied"), true);
});

test("the phone listens for errors, reports a clock punch failure, and queues with the offline cache", () => {
  assert.match(app, /window\.addEventListener\("error"/);
  assert.match(app, /window\.addEventListener\("unhandledrejection"/);
  assert.match(app, /addDoc\(collection\(db, "companies", built\.companyId, "clientErrors"\)/);
  assert.match(app, /createdAt: serverTimestamp\(\)/);
  assert.match(app, /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/);
  const punch = app.slice(app.indexOf("async function tsPunch("), app.indexOf("async function tsSaveManual("));
  assert.match(punch, /reportClientError\(err, "clock"\)/);
  const machine = app.slice(app.indexOf("async function tsChooseMachine("), app.indexOf("function tsAdjustForm("));
  assert.match(machine, /reportClientError\(err, "machine"\)/);
  const share = app.slice(app.indexOf("function liveShareStart("), app.indexOf("function releaseLiveDoc("));
  assert.match(share, /reportClientError\(err, "live share"\)/);
  assert.match(app, /me && me\.role === "admin" \? clientErrorsHtml/);
  assert.match(app, /orderBy\("createdAt", "desc"\), limit\(100\)/);
  const send = app.slice(app.indexOf("function installClientErrorCapture("), app.indexOf("function stopClientErrors("));
  assert.match(send, /writeState = clientErrorWriteDenied\(err\) \? "stopped" : "open"/);
  assert.match(send, /clientErrorWorthSending\(message\)/);
  assert.doesNotMatch(send, /console\.(log|warn|error|debug)/);
  assert.match(app, /ui\.clientErrDenied = true/);
  assert.match(app, /ui\.clientErrState = "hidden"/);
});

test("rules let a member create a phone error and only an admin read it", () => {
  const block = rules.slice(rules.indexOf("match /companies/{companyId}/clientErrors/{errorId}"), rules.indexOf("match /supportTickets/{ticketId}"));
  assert.match(block, /allow get, list: if clientErrorAdmin\(companyId\)/);
  assert.match(block, /allow create: if clientErrorCreate\(companyId\)/);
  assert.match(block, /allow update, delete: if false/);
  assert.match(block, /d\.uid == request\.auth\.uid/);
  assert.match(block, /d\.createdAt == request\.time/);
  assert.match(block, /d\.stack is string && d\.stack\.size\(\) <= 2048/);
  assert.match(block, /d\.keys\(\)\.hasOnly\(\["createdAt", "uid", "role", "appVersion", "swVersion", "screen", "message", "stack", "userAgent", "online"\]\)/);
});
