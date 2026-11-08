import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHECKING_TEXT, JOB_CHECK_WAIT_MS, STILL_TEXT, canRequestJobCheck, jobCheckFailureText, jobCheckView,
} from "../../app/features/job-check.js";
import {
  ALEX_UID, DEFAULT_WEBHOOK_HEADER, PATRICK_UID, RATE_LIMIT_MS, authorizeJobCheck, jobCheckDoc,
  jobCheckWebhookRequest, performJobCheck, webhookHeaderName, withinRateLimit,
} from "../functions/job-check.js";

const NOW = Date.parse("2026-11-08T00:00:00Z");
const heartwood = { name: "Heartwood Earthworx", plan: "paid", origin: "heartwood", isTest: false };

function office(uid, profile, company = heartwood) {
  return { uid, profile, company, now: NOW, url: "https://example.test/hook", key: "secret-key", headerName: "" };
}

test("the Jobs button is Heartwood admins and supervisors only", () => {
  assert.equal(canRequestJobCheck({ role: "admin", companyId: "heartwood" }), true);
  assert.equal(canRequestJobCheck({ role: "supervisor", companyId: "heartwood" }), true);
  assert.equal(canRequestJobCheck({ role: "operator", staffRole: "supervisor", companyId: "heartwood" }), true);
  assert.equal(canRequestJobCheck({ role: "admin", staffRole: "operator", companyId: "heartwood" }), true);
  assert.equal(canRequestJobCheck({ role: "operator", companyId: "heartwood" }), false);
  assert.equal(canRequestJobCheck({ role: "operator", staffRole: "operator", companyId: "heartwood" }), false);
  assert.equal(canRequestJobCheck({ role: "admin", companyId: "acme" }), false);
  assert.equal(canRequestJobCheck({ role: "supervisor", companyId: "mate" }), false);
  assert.equal(canRequestJobCheck({ role: "admin", companyId: "heartwood", isTest: true }), false);
  assert.equal(canRequestJobCheck({ role: "supervisor", companyId: "yard", isTest: true }), false);
  assert.equal(canRequestJobCheck({ role: "admin", companyId: "heartwood", plan: "friend" }), false);
  assert.equal(canRequestJobCheck({ role: "admin", companyId: "heartwood", origin: "friend" }), false);
  assert.equal(canRequestJobCheck({ role: "supervisor", companyId: "mate", plan: "friend", origin: "friend" }), false);
  assert.equal(canRequestJobCheck(null), false);
});

test("status stays on checking, then shows the result, then the 15 minute note", () => {
  assert.equal(jobCheckView(null, NOW).message, "");
  const pending = jobCheckView({ pending: true, status: "requested", startedAt: NOW }, NOW + 1000);
  assert.equal(pending.message, CHECKING_TEXT);
  assert.equal(pending.disabled, true);
  assert.equal(CHECKING_TEXT, "Checking emails and portals…");
  const almost = jobCheckView({ status: "requested", startedAt: NOW }, NOW + JOB_CHECK_WAIT_MS - 1);
  assert.equal(almost.message, CHECKING_TEXT);
  const waiting = jobCheckView({ status: "requested", pending: true, startedAt: NOW }, NOW + JOB_CHECK_WAIT_MS);
  assert.equal(waiting.message, STILL_TEXT);
  assert.equal(waiting.disabled, false);
  assert.equal(STILL_TEXT, "Still checking, new jobs will appear in the Inbox");
  const unfinished = jobCheckView({ status: "done", summary: "Imported 2", startedAt: NOW }, NOW + 1000);
  assert.equal(unfinished.message, CHECKING_TEXT);
  const done = jobCheckView({ status: "done", summary: " Imported 2 jobs ", finishedAt: NOW + 5000, startedAt: NOW }, NOW + 6000);
  assert.equal(done.message, "Imported 2 jobs");
  assert.equal(done.error, false);
  assert.equal(done.disabled, false);
  const failed = jobCheckView({ status: "error", summary: "Portal login failed", finishedAt: NOW + 5000, startedAt: NOW }, NOW + 9000);
  assert.equal(failed.message, "Portal login failed");
  assert.equal(failed.error, true);
  assert.equal(jobCheckFailureText({ code: "resource-exhausted" }), "A check already started. Try again in a couple of minutes.");
  assert.equal(jobCheckFailureText({ status: "PERMISSION_DENIED" }), "Only a Heartwood admin or supervisor can check for jobs.");
  assert.equal(jobCheckFailureText({ code: "failed-precondition", message: "Job check is not set up yet." }), "Job check is not set up yet.");
  assert.equal(jobCheckFailureText({ code: "unavailable" }), "Couldn't start the check. Try again shortly.");
});

test("only a Heartwood admin or supervisor can request, and not a test or friend company", () => {
  assert.equal(authorizeJobCheck({ uid: "", profile: null, company: heartwood }).code, "unauthenticated");
  assert.equal(authorizeJobCheck({ uid: ALEX_UID, profile: null, company: null }).ok, true);
  assert.equal(authorizeJobCheck({ uid: PATRICK_UID, profile: { role: "operator" }, company: heartwood }).ok, true);
  assert.equal(authorizeJobCheck({ uid: "sup", profile: { role: "supervisor", companyId: "heartwood" }, company: heartwood }).ok, true);
  assert.equal(authorizeJobCheck({ uid: "adm", profile: { role: "admin" }, company: heartwood }).ok, true);
  assert.equal(authorizeJobCheck({ uid: "op", profile: { role: "operator" }, company: heartwood }).code, "permission-denied");
  assert.equal(authorizeJobCheck({ uid: "other", profile: { role: "admin", companyId: "acme" }, company: heartwood }).code, "permission-denied");
  assert.equal(authorizeJobCheck({ uid: "friend", profile: { role: "supervisor", companyId: "mate" }, company: heartwood }).code, "permission-denied");
  assert.equal(authorizeJobCheck({ uid: ALEX_UID, profile: null, company: { ...heartwood, isTest: true } }).reason, "blocked-company");
  assert.equal(authorizeJobCheck({ uid: "sup", profile: { role: "supervisor", tenantId: "heartwood" }, company: { plan: "friend" } }).reason, "blocked-company");
  assert.equal(authorizeJobCheck({ uid: "sup", profile: { role: "admin", companyId: "heartwood" }, company: { origin: "friend", isTest: false } }).reason, "blocked-company");
});

test("a check is kept two minutes apart and posts the routine webhook", async () => {
  assert.equal(RATE_LIMIT_MS, 120000);
  assert.equal(withinRateLimit(NOW - 119999, NOW), true);
  assert.equal(withinRateLimit(NOW - RATE_LIMIT_MS, NOW), false);
  assert.equal(withinRateLimit(null, NOW), false);
  assert.deepEqual(jobCheckDoc({ requestedBy: "sup", requestedAt: NOW }), {
    companyId: "heartwood", requestedBy: "sup", requestedAt: NOW, status: "requested",
  });

  let created = null;
  let posted = null;
  let marked = null;
  const ok = await performJobCheck({
    ...office("sup", { role: "supervisor", companyId: "heartwood" }),
    lastRequestedAt: NOW - RATE_LIMIT_MS,
    async createCheck(body) { created = body; return { id: "jc1" }; },
    async markError() { throw new Error("should not mark"); },
    async post(request) { posted = request; return { ok: true, status: 200 }; },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.requestId, "jc1");
  assert.equal(created.status, "requested");
  assert.equal(created.companyId, "heartwood");
  assert.equal(created.requestedBy, "sup");
  assert.equal(posted.method, "POST");
  assert.equal(posted.headers[DEFAULT_WEBHOOK_HEADER], "Bearer secret-key");
  assert.equal(posted.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(posted.body), { requestId: "jc1", requestedBy: "sup" });
  assert.equal(webhookHeaderName(""), DEFAULT_WEBHOOK_HEADER);
  assert.equal(webhookHeaderName("Authorization"), DEFAULT_WEBHOOK_HEADER);
  assert.equal(webhookHeaderName("content-type"), DEFAULT_WEBHOOK_HEADER);

  const custom = jobCheckWebhookRequest({
    url: "https://example.test/hook", key: "secret-key", headerName: "X-Job-Check-Key", requestId: "jc1", requestedBy: "sup",
  });
  assert.equal(custom.headers["X-Job-Check-Key"], "Bearer secret-key");
  assert.equal(custom.headers.Authorization, undefined);

  const limited = await performJobCheck({
    ...office(ALEX_UID, null),
    lastRequestedAt: NOW - 1000,
    async createCheck() { throw new Error("should not create"); },
    async markError() { throw new Error("should not mark"); },
    async post() { throw new Error("should not post"); },
  });
  assert.equal(limited.code, "resource-exhausted");

  const early = await performJobCheck({
    ...office("op", { role: "operator" }),
    async createCheck() { throw new Error("should not create"); },
    async markError() {},
    async post() { throw new Error("should not post"); },
  });
  assert.equal(early.code, "permission-denied");

  const bare = await performJobCheck({
    ...office(ALEX_UID, null),
    url: "",
    async createCheck() { throw new Error("should not create"); },
    async markError() {},
    async post() { throw new Error("should not post"); },
  });
  assert.equal(bare.reason, "not-configured");

  const webhook = await performJobCheck({
    ...office(ALEX_UID, null),
    async createCheck() { return { id: "jc9" }; },
    async markError(id, patch) { marked = { id, patch }; },
    async post() { return { ok: false, status: 403 }; },
  });
  assert.equal(webhook.code, "failed-precondition");
  assert.equal(webhook.requestId, "jc9");
  assert.equal(marked.id, "jc9");
  assert.equal(marked.patch.summary, "The check did not start. Try again in a couple of minutes.");
  assert.equal(marked.patch.finishedAtMs, NOW);

  const dropped = await performJobCheck({
    ...office("sup", { role: "admin", companyId: "heartwood" }),
    async createCheck() { return { id: "jc8" }; },
    async markError(id, patch) { marked = { id, patch }; },
    async post() { throw new Error("network"); },
  });
  assert.equal(dropped.requestId, "jc8");
  assert.equal(marked.id, "jc8");

  let racedMarked = false;
  const raced = await performJobCheck({
    ...office(ALEX_UID, null),
    async createCheck() {
      const err = new Error("rate");
      err.code = "resource-exhausted";
      throw err;
    },
    async markError() { racedMarked = true; },
    async post() { throw new Error("should not post"); },
  });
  assert.equal(raced.code, "resource-exhausted");
  assert.equal(racedMarked, false);
});

test("the shell, callable, and rules are wired for this check", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const feature = readFileSync(new URL("../../app/features/job-check.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emulator = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  assert.match(app, /Check for jobs/);
  assert.match(feature, /Checking emails and portals…/);
  assert.match(feature, /Still checking, new jobs will appear in the Inbox/);
  assert.match(app, /jobCheckView/);
  assert.match(app, /id="jobcheck"/);
  assert.match(app, /canRequestJobCheck/);
  assert.match(app, /requestJobCheck/);
  assert.match(app, /australia-southeast1/);
  assert.match(app, /jobChecks/);
  const jobsHead = app.slice(app.indexOf("function jobsView"), app.indexOf("function unscheduledView"));
  assert.match(jobsHead, /jobCheckHtml\(\)/);
  const week = app.slice(app.indexOf("const jobCheck = ui.opTab"), app.indexOf("function renderOpDetail"));
  assert.match(week, /jobCheckHtml\(\)/);
  assert.match(week, /job-check-op/);
  assert.match(sw, /callup-shell-v80-job-check/);
  assert.match(sw, /features\/job-check\.js/);
  assert.match(index, /export const requestJobCheck = onCall/);
  assert.match(index, /region: "australia-southeast1"/);
  assert.match(index, /JOB_CHECK_WEBHOOK_URL/);
  assert.match(index, /JOB_CHECK_WEBHOOK_KEY/);
  assert.match(index, /JOB_CHECK_WEBHOOK_HEADER/);
  assert.match(index, /jobCheckDoc\(/);
  assert.match(index, /companyId: "heartwood"/);
  assert.match(readFileSync(new URL("../functions/job-check.js", import.meta.url), "utf8"), /status: "requested"/);
  assert.match(rules, /match \/jobChecks\/\{id\}/);
  assert.match(emulator, /match \/jobChecks\/\{id\}/);
  assert.match(rules, /allow create, update, delete: if false/);
});
